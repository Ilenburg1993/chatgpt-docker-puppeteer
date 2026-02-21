# Plano Mestre de Execução - Gemini

**Data Início:** 16 de fevereiro de 2026 **Responsável:** Gemini (Agent) **Status:** Em Progresso
**Arquivo de Controle:** `.gemini/PLANO_MESTRE.md`

Este documento serve como a fonte única da verdade para o progresso do trabalho, contendo o plano
detalhado, o status de cada tarefa e o log de execução.

---

## 1. Visão Geral

O objetivo é realizar uma varredura completa no código (`src/`), identificar e corrigir bugs
críticos, fragilidades arquiteturais e débitos técnicos, ignorando relatórios anteriores e focando
na análise estática e dinâmica atual.

## 2. Status das Tarefas

| ID     | Tarefa                                           | Status        | Prioridade |
| :----- | :----------------------------------------------- | :------------ | :--------- |
| **01** | **Análise Inicial e Varredura**                  | ✅ Concluído   | P0         |
| **02** | **Consolidação de Pools (Hot/Cold)**             | ✅ Concluído   | P0         |
| **03** | **Correção `ResilientLock` (No-Crash)**          | ✅ Concluído   | P0         |
| **04** | **Upgrade `ResilientLock` (Release Timeout)**    | ✅ Concluído   | P1         |
| **05** | **Correção CORS (Security Hardening)**           | ✅ Concluído   | P0         |
| **06** | **Refatoração `DriverFactory` (Config Central)** | ✅ Concluído   | P1         |
| **07** | **Tipagem JSDoc (Remoção de `any`)**             | 🔄 Em Execução | P2         |
| **08** | **Reorganização de Testes**                      | ⏳ Pendente    | P2         |

---

## 3. Detalhamento e Logs de Execução

### TAREFA 01: Análise Inicial

- **Objetivo:** Identificar bugs e fragilidades sem viés anterior.
- **Execução:** Varredura em `src/`, `tests/` e `config/`.
- **Resultado:** Relatório gerado em `DOCUMENTAÇÃO/BUGS/ANALISE_COPILOT_2026-02-16.md`. Principais
  achados: `process.exit` em lock, Duplicação de Pool, CORS frágil.

### TAREFA 02: Consolidação de Pools

- **Objetivo:** Unificar `DriverFactory` e `BrowserPool` em arquitetura "Hot Pool".
- **Execução:**
  - `DriverFactory`: Adicionado `setBrowserPool`, `_createHotDriver`.
  - `TargetDriver`: Adicionado suporte a Hot Swap (`attachContext` idempotente para mesma página),
    estados `isHot`/`isCold` e eventos `CONTEXT_HOT_SWAP`.
  - `DriverNERVAdapter`: Atualizado para consumir drivers quentes ou alocar frios (fallback).
- **Resultado:** Arquitetura v3.1 implementada.

### TAREFA 03: Correção `ResilientLock`

- **Objetivo:** Remover `process.exit` e handlers globais de erro.
- **Execução:**
  - Removidos listeners `uncaughtException`/`unhandledRejection`.
  - Removidos chamados a `process.exit()`.
  - Mantidos listeners de `SIGINT`/`SIGTERM` apenas para limpeza.
- **Resultado:** Biblioteca segura para uso em produção.

### TAREFA 04: Upgrade `ResilientLock` (Atual)

- **Objetivo:** Adicionar timeout de segurança no `releaseAll` para evitar hang no shutdown.
- **Plano:**
  1.  Modificar `releaseAll` para aceitar `timeoutMs`.
  2.  Implementar `Promise.race` com timer.
  3.  Validar se o timeout não quebra a lógica existente.

### TAREFA 05: Correção CORS

- **Objetivo:** Remover IPs hardcoded e externalizar configuração.
- **Plano:**
  1.  Criar variável de ambiente `ALLOWED_ORIGINS` em `src/core/config.js`.
  2.  Atualizar `src/server/engine/app.js` para ler essa lista.
  3.  Implementar validação flexível (suporte a CIDR ou Regex se necessário).

---

## 4. Instruções de Trabalho (Meta)

1.  **Sempre** consultar este arquivo antes de iniciar uma nova tarefa.
2.  **Sempre** atualizar o status da tarefa atual para "Em Execução".
3.  **Sempre** registrar o resultado no log de execução ao finalizar.
4.  Seguir rigorosamente o ciclo: Planejar -> Executar -> Validar -> Documentar.

---

_Última atualização: 16/02/2026 10:45_
