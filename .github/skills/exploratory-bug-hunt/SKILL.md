---
name: exploratory-bug-hunt
user-invokable: true
description:
  'Skill para caça proativa de bugs e gaps sem pistas iniciais; gera relatório versionado e aplica
  correções. v2.0: 10 categorias de inspeção obrigatórias, checklists técnicos e grep-first approach.'
---

# exploratory-bug-hunt

## Overview

Skill proativa para descoberta sem pista inicial. Ela existe para varrer áreas pouco exploradas,
componentes críticos ou rodadas periódicas de caça a bugs/gaps. A partir da v2.0, inclui 10
categorias de inspeção obrigatórias e um checklist técnico por arquivo, com abordagem grep-first
para maximizar cobertura antes de leitura individual.

## Recommended Tuple

- `audit_mode=exploratory_bug`
- `profile=deep` por default
- `profile=nightly` para varredura ampla
- `proposal_depth=standard|deep`

## When To Use

- Não existe bug reportado, mas você quer encontrar riscos reais.
- A área tem alto churn, criticidade alta ou pouca cobertura histórica.
- Você precisa produzir backlog de achados por escopo.
- Rodadas periódicas de higiene de código (semanal/quinzenal).

## When Not To Use

- Não usar quando já existe stack trace ou bug reportado; use `reactive-bug-audit`.
- Não usar para baseline operacional; use `audit-runbook-observability`.

## Inputs / Preconditions

- escopo inicial (arquivo, diretório, módulo ou conjunto por churn)
- `npm run audit:exploratory-bug-hunt` ou `npm run audit:nightly`
- referências:
  - `references/scope-selection-playbook.md`
  - `references/exploratory-report-template.md`
  - `references/bug-patterns-catalog.md`
  - `references/inspection-checklist.md`

## Workflow Expandido (v2.0)

### 1. Definir e Registrar Escopo

Escolher o escopo seguindo o playbook de seleção. Registrar:

- Lista de diretórios/arquivos a cobrir
- Módulos cobertos em rodadas anteriores (excluir duplicata)
- Critério de priorização (churn, criticidade, coverage histórica)

### 2. Varredura por Grep/Glob (sinais amplos — executar antes de ler arquivos)

```bash
# Timers sem cancelamento
grep -rn "setTimeout\|setInterval" src/ --include="*.js" | grep -v "clear\|//"

# addEventListener sem removeEventListener no mesmo arquivo
grep -rn "addEventListener" src/ --include="*.js" | grep -v "removeEventListener\|{ once:"

# async em setTimeout/setInterval (unhandled rejection)
grep -rn "setTimeout(async\|setInterval(async" src/ --include="*.js"

# parseInt sem radix
grep -rn "parseInt(" src/ --include="*.js" | grep -v ", 10\|, 16\|, 2\|//"

# JSON.parse sem try/catch contexto
grep -rn "JSON\.parse" src/ --include="*.js"

# TODOs e FIXMEs pendentes
grep -rn "TODO\|FIXME\|HACK\|XXX" src/ --include="*.js" | grep -v "//.*TODO"

# require() em módulos ESM
grep -rn "^[^/]*require(" src/ --include="*.js"

# process.exit() direto (exceto entrypoints)
grep -rn "process\.exit" src/ --include="*.js" | grep -v "main\.js"

# catch vazio ou void que pode ocultar erros
grep -rn "catch\s*[({]" src/ --include="*.js" | grep "void\|{}"

# HTTP 200 para endpoints não implementados
grep -rn "not implemented\|Not Implemented" src/ --include="*.js" | grep -v "501"
```

### 3. Leitura e Análise — Checklist de 10 Categorias

Para cada arquivo do escopo, verificar:

**C1 — Resource Leaks (Timers e Listeners)**
- Cada `setInterval` tem `clearInterval` correspondente?
- Cada `addEventListener` tem `removeEventListener` no teardown?
- Timers com referência salva para cancelamento?
- Conexões abertas (TCP, WebSocket, file handles) fechadas?

**C2 — Async e Concorrência**
- `async` callback em `setInterval/setTimeout` tem `.catch()` ou `try/catch`?
- Funções `async` chamadas sem `await` onde deveria aguardar?
- Race conditions em recursos compartilhados sem guard?
- Reentrância em loops periódicos (guard flag ou Promise serial)?

**C3 — Error Handling e Robustez**
- `try/catch` vazio ou silencioso sem logging?
- `.catch(() => {})` suprimindo erros que não deveriam ser ignorados?
- HTTP responses verificadas antes de `.json()` ou `.text()`?
- Erros de terceiros (PM2, DB, filesystem) tratados graciosamente?

**C4 — Null / Undefined Dereference**
- Acesso a propriedade de objeto potencialmente nulo sem optional chaining?
- Destructuring sem default values em objetos opcionais?
- Array methods em variáveis que podem ser `null`/`undefined`?

**C5 — Lógica de Controle**
- Condicionais com ramos impossíveis (dead code)?
- Ternários com ambos os branches iguais?
- Flags de estado nunca resetadas ou sempre no mesmo valor?
- Circuit breakers com lógica invertida?

**C6 — Parsing e Serialização**
- `JSON.parse()` sem `try/catch`?
- `parseInt()` sem radix `10`?
- Dados externos usados sem sanitização?

**C7 — Segurança**
- Segredos hardcoded (tokens, passwords, keys)?
- Logs expondo dados sensíveis (tokens, senhas, PII)?
- SQL injection (template literals em queries)?
- Path traversal (path.join com inputs externos)?
- CORS permissivo demais ou CSP ausente?

**C8 — Compatibilidade ESM e Node.js 24+**
- `require()` ou `module.exports` em arquivos `.js`?
- `__dirname` / `__filename` em ESM sem `import.meta.url`?
- APIs deprecated em Node.js 24?

**C9 — Performance e Eficiência**
- N+1 queries (loop com DB calls dentro)?
- `JSON.parse(JSON.stringify(x))` como clone (use `structuredClone`)?
- Processamento síncrono bloqueante no event loop?
- Caches sem limite de tamanho (memory leak potencial)?

**C10 — Completude Funcional**
- TODOs/FIXMEs em código ativo que afetam comportamento?
- HTTP 200 para endpoints não implementados?
- Validações de input ausentes em handlers públicos?
- JSDoc inconsistente com implementação real?

### 4. Consolidar Achados

- Confirmar bug lendo o código ao redor (não reportar sem evidência)
- Classificar: CRÍTICO / ALTO / MÉDIO / BAIXO
- Propor correção cirúrgica mínima

### 5. Aplicar Correções CRÍTICO/ALTO

- Uma correção por vez, arquivo por arquivo
- `npm run test:unit` após cada grupo de correções
- `npm run lint` para verificar style

### 6. Gerar Relatório Versionado

Usar template `references/exploratory-report-template.md`. Incluir:

- Escopo declarado e coberto
- Tabela de achados (ID, severidade, arquivo, status)
- Seção por achado com evidência de código
- Próximos passos e backlog

## Guardrails

- Não começar sem delimitar escopo.
- Não duplicar no relatório trechos já auditados na mesma rodada.
- **Nunca reportar achado sem ler o código ao redor** — confirmar antes de registrar.
- Não aplicar correções sem rodar testes.
- Em rodadas recorrentes, verificar achados anteriores antes de inspecionar novos escopos.

## Validation / Done Criteria

- Escopo declarado e coberto de forma rastreável.
- Relatório versionado com seção por achado e evidência.
- Checklist de 10 categorias aplicado.
- Testes: sem regressões introduzidas.
- Lint: sem novas violações.

## Related Skills

- `reactive-bug-audit` — bugs com pista inicial.
- `audit-proposal-deep-triage` — P0/P1 descobertos.
- `security-checklist` — aprofundar C7.
- `performance-audit` — aprofundar C9.
- `code-audit-and-fix` — combina exploratório + aplicação de patches.
