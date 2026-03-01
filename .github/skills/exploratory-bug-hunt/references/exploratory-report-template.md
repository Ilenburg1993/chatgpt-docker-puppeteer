# Exploratory Report Template v2.0

## Metadados

- `versão`: N.0
- `data`: YYYY-MM-DD
- `auditor`: Copilot SWE Agent (exploratory-bug-hunt v2.0)
- `escopo`: lista de módulos/arquivos cobertos
- `perfil`: deep | nightly
- `pr_associada`: branch/PR name
- `rodada`: N

---

## Resumo Executivo

[Total de achados, quantos críticos/altos/médios/baixos, quantos corrigidos vs backlog]

---

## Status dos Achados

| ID | Severidade | Arquivo | Linha | Status |
|----|-----------|---------|-------|--------|
| C001 | CRÍTICO | `src/...` | L123 | ✅ Corrigido |
| A001 | ALTO | `src/...` | L456 | ✅ Corrigido |
| M001 | MÉDIO | `src/...` | L789 | ⏳ Backlog |
| B001 | BAIXO | `src/...` | L012 | ✅ Corrigido |

---

## Achados Detalhados

### [ID] — [SEVERIDADE] | [Título curto]

**Arquivo**: `src/.../arquivo.js:L123`

**Categoria**: C1 / C2 / C3 / C4 / C5 / C6 / C7 / C8 / C9 / C10

**Problema**:
[Descrição objetiva do bug com trecho de código evidenciando o problema]

```js
// CÓDIGO COM PROBLEMA (antes):
código problemático aqui
```

**Correção**:
[Descrição da correção aplicada ou proposta]

```js
// CÓDIGO CORRIGIDO (depois):
código correto aqui
```

**Status**: ✅ Corrigido / ⏳ Backlog / ❌ Descartado (razão)

---

## Backlog (Não Corrigidos Nesta Rodada)

| ID | Sev. | Arquivo | Razão do Adiamento |
|----|------|---------|-------------------|
| M001 | MÉDIO | `src/...` | Requer refatoração maior — escopo futuro |

---

## Sumário de Segurança

- CodeQL: [N alertas]
- Vulnerabilidades de segurança: [lista ou "nenhuma identificada"]
- Correções que eliminam caminhos de crash/leak: [lista]

---

## Impacto nos Testes

- Antes: [N pass] / [N fail]
- Depois: [N pass] / [N fail]
- Regressões: [nenhuma / lista]

---

## Próximos Passos

1. [Próximo escopo a cobrir]
2. [Achados de backlog para priorizar]
3. [Outros módulos suspeitos identificados]
