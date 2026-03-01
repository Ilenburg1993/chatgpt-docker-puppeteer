# Plano de Hardening de Tipagem - Remoção de `any`

**Data:** 16 de fevereiro de 2026 **Autor:** GitHub Copilot **Status:** Planejamento **Alvo:**
Diversos arquivos em `src/` com casts para `any`.

## 1. Contexto e Problema

A varredura inicial identificou mais de 20 ocorrências de `/** @type {any} */` ou
`(/** @type {any} */ (obj))`. Isso silencia o compilador TypeScript (que roda via JSDoc/checkJs),
mas oculta bugs e dificulta a refatoração segura.

**Exemplos de Gaps de Tipagem:**

1.  **NERV Instances:** Muitos objetos recebem `any` porque a interface do NERV não está definida
    globalmente.
2.  **Circuit Breaker:** Injeções dinâmicas de dependência.
3.  **Express Request/Response:** Casts em controllers para acessar propriedades customizadas.

## 2. Objetivo

Reduzir drasticamente o uso de `any`, substituindo-os por:

- Interfaces JSDoc (`@typedef`).
- Importações de tipos reais do Puppeteer/Express.
- Tipagem estrutural (Structural Typing).

## 3. Estratégia de Implementação (Fases)

### Fase A: Definição de Tipos Globais

Criar ou expandir `src/types/` (se existir) ou adicionar `@typedef` em arquivos base para:

- `NERVInstance`
- `BrowserPoolInstance`
- `TaskV5`
- `DriverInstance`

### Fase B: Limpeza Cirúrgica

Priorizar arquivos core:

1.  `src/core/boot_resilience_manager.js` (Resiliência do boot).
2.  `src/server/engine/socket.js` (Eventos de socket).
3.  `src/core/forensics.js` (Extração de dados).

### Fase C: Validação

Rodar `npx tsc -p tsconfig.json --noEmit` para garantir que a remoção do `any` não introduziu erros
reais de tipo que estavam mascarados.

---

## 4. Plano de Execução

1.  **Auditoria Detalhada:** Listar os Top 5 arquivos com mais `any`.
2.  **Implementação de Tipos Base:** Criar definições JSDoc para as entidades principais.
3.  **Refatoração:** Aplicar as trocas em lotes por arquivo.

---

_Pronto para execução da Fase A._
