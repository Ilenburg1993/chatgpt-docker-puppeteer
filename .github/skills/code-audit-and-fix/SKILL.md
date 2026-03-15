---
name: code-audit-and-fix
user-invocable: true
description:
  'Skill canônica para auditar código e aplicar correções diretamente. Combina exploração proativa,
  triagem de severidade e aplicação cirúrgica de patches com validação automática. Use quando o
  objetivo é encontrar bugs E corrigi-los na mesma sessão.'
---

# code-audit-and-fix

## Overview

Skill que unifica exploração proativa e aplicação de patches. Diferente de `exploratory-bug-hunt`
(que apenas descobre e registra) e `reactive-bug-audit` (que parte de pistas existentes), esta skill
completa o ciclo: descobre, prioriza e **corrige** bugs na mesma sessão.

Ela é a skill canônica para sessões de "bug hunt + fix" onde o objetivo é entregar código corrigido
e testado, não apenas um relatório.

## When To Use

- Sessões periódicas de melhoria de qualidade de código.
- Quando há tempo suficiente para cobrir um módulo completo com aplicação de correções.
- Sprints de debt técnico com meta de entrega de PRs.
- Quando o mantenedor solicita "encontre e corrija bugs".

## When Not To Use

- Não usar para exploração apenas (use `exploratory-bug-hunt`).
- Não usar para um bug específico já conhecido (use `reactive-bug-audit`).
- Não usar quando o risco de regressão é alto sem testes de integração disponíveis.
- Não usar quando a solicitação for diagnóstico formal com relatório estruturado (issues + upgrades)
  sem aplicação imediata de patch; nesse caso, usar `code-audit`.

## Inputs / Preconditions

- Escopo (módulo, diretório ou conjunto de arquivos)
- Baseline de testes passando (`npm run test:unit`)
- Acesso de escrita ao repositório

## Workflow Completo

### Fase 1 — Baseline

```bash
npm run test:unit 2>&1 | grep -E "pass|fail"
npm run lint 2>&1 | tail -5
```

Registrar: `X pass / Y fail` antes de qualquer mudança.

### Fase 2 — Varredura Grep-First (5-10 min)

Executar os padrões de busca do `exploratory-bug-hunt`:

```bash
grep -rn "setTimeout\|setInterval" src/ | grep -v "clear\|//"
grep -rn "addEventListener" src/ | grep -v "removeEventListener\|once:"
grep -rn "setTimeout(async\|setInterval(async" src/
grep -rn "parseInt(" src/ | grep -v ", 10\|, 16"
grep -rn "TODO\|FIXME" src/ | grep -v "//.*TODO"
```

### Fase 3 — Leitura e Confirmação de Bugs

Para cada sinal encontrado:

1. Ler o arquivo ao redor do sinal (mínimo 20 linhas de contexto)
2. Confirmar se é realmente um bug (não reportar sem evidência)
3. Classificar severidade e categoria (C1-C10)
4. Escrever a correção mínima

### Fase 4 — Aplicar Correções em Ordem de Severidade

Ordem de aplicação: CRÍTICO → ALTO → MÉDIO → BAIXO

Para cada correção:

1. Aplicar a mudança mínima
2. Verificar que o arquivo ainda é válido sintaticamente
3. Após cada grupo (mesmo arquivo), rodar subset de testes relevante

### Fase 5 — Validação Final

```bash
npm run test:unit 2>&1 | grep -E "pass|fail"
npm run lint
```

Confirmar: sem regressões (pass >= baseline, fail <= baseline).

### Fase 6 — Documentação e Relatório

- Atualizar `DOCUMENTAÇÃO/AUDITORIAS/` com achados e status
- Fazer commit com mensagem descritiva: `fix: [módulo] - [N bugs] corrigidos ([IDs])`
- Push via report_progress

## Guardrails

- **Nunca aplicar patch sem confirmar o bug** lendo o código.
- **Sempre rodar testes** após cada grupo de correções.
- **Não modificar testes** para fazer passar — apenas código fonte.
- **Mínima mudança necessária** — não refatorar o que não está quebrado.
- **Um commit por grupo de correções** relacionadas.

## Checklist de Severidade Rápida

| Severidade | Exemplos                                                                | Ação                                 |
| ---------- | ----------------------------------------------------------------------- | ------------------------------------ |
| CRÍTICO    | Data corruption, crash em produção, lógica invertida que nunca funciona | Corrigir imediatamente               |
| ALTO       | Resource leak, unhandled rejection, null dereference em caminho comum   | Corrigir nesta sessão                |
| MÉDIO      | Timer sem referência, reentrância não protegida, parseInt sem radix     | Corrigir se possível, backlog se não |
| BAIXO      | HTTP 200 para 501, comentário JSDoc incorreto, nit estilo               | Backlog                              |

## Validation / Done Criteria

- Bugs CRÍTICO/ALTO corrigidos nesta sessão.
- Zero regressões introduzidas (testes e lint).
- Relatório atualizado em `DOCUMENTAÇÃO/AUDITORIAS/`.
- Commits descritivos com IDs dos bugs corrigidos.

## Related Skills

- `code-audit` — diagnóstico manual profundo com entrega formal em duas partes, sem obrigação de
  corrigir no mesmo ciclo.
- `exploratory-bug-hunt` — exploração sem correção.
- `reactive-bug-audit` — correção a partir de bug conhecido.
- `security-checklist` — foco em C7 (segurança).
- `performance-audit` — foco em C9 (performance).
