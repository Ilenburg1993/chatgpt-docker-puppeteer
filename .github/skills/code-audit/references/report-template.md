# Template de Relatório — Code Audit

Use este modelo para a saída final da skill.

```markdown
# Relatório de Auditoria de Código — [Escopo]

## Sumário executivo
[Panorama técnico do escopo auditado, padrão dos problemas encontrados e urgência geral.]

## Contexto da auditoria
- Escopo: [arquivo/pasta/módulo/fluxo]
- Runtime/stack considerada: [Node, browser, etc.]
- Premissas/restrições: [se houver]

## Tabela-resumo

### Issues (Parte I)
| ID      | Arquivo/Linhas | Categoria | Severidade | Título   |
| ------- | -------------- | --------- | ---------- | -------- |
| BUG-001 | src/...:10-35  | Lógica    | Alta       | [título] |

### Upgrades (Parte II)
| ID      | Categoria       | Prioridade | Título   |
| ------- | --------------- | ---------- | -------- |
| UPG-001 | Observabilidade | Média      | [título] |

---

## Parte I — Issues detalhados

### [ID: BUG-001] [Título]
- **Arquivo/Linhas:** [caminho:linhas]
- **Categoria:** [categoria]
- **Severidade:** [Crítica/Alta/Média/Baixa/Info]
- **Descrição:**
  [Explicação técnica do problema e condição de falha.]
- **Cenário de reprodução/manifestação:**
  [Passos mínimos ou cenário causal.]
- **Impacto:**
  [Impacto técnico/negócio.]
- **Proposta de correção:**
  [Mudança sugerida de forma acionável.]
- **Referências:**
  [Specs/docs relevantes, quando necessário.]

(Repita para cada issue)

---

## Parte II — Upgrades detalhados

### [ID: UPG-001] [Título]
- **Categoria:** [Performance/Segurança/Manutenibilidade/Modernização/Testabilidade/Observabilidade]
- **Prioridade:** [Alta/Média/Baixa]
- **Motivação:**
  [Por que esse upgrade agrega valor no contexto auditado.]
- **Implementação proposta:**
  [Passos, estratégia incremental e/ou snippet conceitual.]
- **Trade-offs e riscos:**
  [Custos, dependências e riscos de adoção.]

(Repita para cada upgrade)

---

## Conclusão e próximos passos

1. [Ação prioritária 1]
2. [Ação prioritária 2]
3. [Ação prioritária 3]

## Perguntas de continuidade
- Deseja aprofundar algum issue específico?
- Deseja que eu implemente algum item agora?
- Há contexto adicional que pode alterar a priorização?
```
