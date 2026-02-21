# Refatoração DriverFactory - Centralização de Configuração

**Data:** 16 de fevereiro de 2026 **Autor:** GitHub Copilot **Status:** Planejamento **Alvo:**
`src/driver/factory.js` e `src/core/config.js`

## 1. Contexto e Problema

Atualmente, o `DriverFactory` inicializa sua configuração lendo diretamente de `process.env` (ex:
`process.env.DRIVER_POOL_MAX_SIZE`), duplicando a lógica que deveria estar centralizada em
`src/core/config.js`.

**Problemas:**

1.  **Duplicação:** Se mudarmos o nome da env var, temos que mudar em dois lugares.
2.  **Falta de Validação:** O `config.js` usa Zod para validar tipos e limites, mas o Factory ignora
    isso e faz `parseInt` manual.
3.  **Testabilidade:** Difícil mockar a configuração sem poluir `process.env`.

## 2. Objetivo

Refatorar o `DriverFactory` para injetar a configuração via construtor ou importar o Singleton
`CONFIG`, garantindo que todas as variáveis sejam validadas e centralizadas.

## 3. Estratégia de Implementação

### Passo 1: Atualizar `src/core/config.js`

Adicionar os parâmetros do driver ao Schema Zod mestre:

- `DRIVER_POOL_MAX_SIZE` (default: 5)
- `DRIVER_POOL_MIN_SIZE` (default: 2)
- `DRIVER_IDLE_TIMEOUT_MS` (default: 300000)
- `DRIVER_WARMUP_TARGETS` (array)
- `DRIVER_POOL_ENABLED` (boolean)
- `DRIVER_BACKPRESSURE_TIMEOUT_MS` (default: 5000)

### Passo 2: Atualizar `src/driver/factory.js`

1.  Remover constante `FACTORY_CONFIG` baseada em `process.env`.
2.  No construtor, aceitar um objeto `config` (opcional).
3.  Se não fornecido, usar `CONFIG` importado de `#core/config`.
4.  Substituir todas as referências `FACTORY_CONFIG.XYZ` por `this.config.XYZ`.

### Passo 3: Injeção de Dependência

Atualizar a criação do singleton `factory` no final do arquivo para passar a configuração explícita,
se necessário, ou confiar no default importado.

---

## 4. Plano de Execução

1.  **Editar `src/core/config.js`:** Adicionar novos campos ao Zod.
2.  **Editar `src/driver/factory.js`:**
    - Importar `CONFIG`.
    - Refatorar construtor.
    - Substituir usos de `FACTORY_CONFIG`.
3.  **Validação:** Verificar se o sistema boota sem erros de "config undefined".

---

_Pronto para execução._
