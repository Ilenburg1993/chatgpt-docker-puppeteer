---
name: code-audit
description: >-
  Realiza auditoria manual e aprofundada de uma porção de código especificada pelo usuário.
  Identifica bugs, incompletudes, gaps lógicos e falhas semânticas que ferramentas automáticas
  (ESLint, TypeScript/TSServer, Prettier, Biome, SonarQube, Semgrep, CodeQL etc.) não capturam com
  confiabilidade. Gera um relatório Markdown estruturado com achados, severidade, evidências e
  proposta de correção, além de uma segunda parte obrigatória com upgrades pertinentes ao contexto.
  Use quando o usuário pedir auditoria, revisão profunda, análise de bugs sutis, code review técnico
  semântico ou avaliação de melhorias estruturais em um escopo específico.
user-invocable: true
---

# Code Audit — Auditoria Manual Profunda de Código

## Overview

Esta skill é voltada para auditoria **manual e semântica**. O foco não é estilo, lint ou formatador:
o objetivo é validar se o código está **correto no comportamento**, robusto em cenários reais e
coerente com os contratos do sistema.

### Identidade operacional (posicionamento)

- `audit_mode`: `manual_semantic_report`
- `profile`: `diagnosis_first`
- `proposal_depth`: `deep`
- `escalate_to`:
  - `code-audit-and-fix` quando houver pedido de patch imediato.
  - `semantic-logic-audit` quando a pergunta central for validar **um fluxo crítico ponta a ponta**
    com ênfase em invariantes de estado, mesmo sem foco em relatório formal.

### Regra absoluta

- Durante a auditoria, **não usar** ferramentas automáticas de análise estática, lint, typecheck ou
  formatadores para decidir achados (ESLint, TypeScript, Prettier, Biome, SonarQube, Semgrep, CodeQL
  e similares).
- A auditoria deve ser baseada em leitura integral, raciocínio causal, verificação de invariantes e
  análise de fluxo de dados/estado.

## When To Use

Use esta skill quando o usuário pedir:

- Auditoria profunda de arquivo, módulo, diretório ou fluxo.
- Revisão técnica com foco em bugs sutis, falhas semânticas e inconsistências de contrato.
- Relatório de riscos com priorização técnica.
- Levantamento de upgrades aplicáveis ao código já existente.

Use também quando a entrega esperada for um **artefato de auditoria formal**
(registrável/compartilhável) com duas partes obrigatórias: issues e upgrades.

## When Not To Use

- Quando a necessidade for somente corrigir estilo/format.
- Quando a solicitação for apenas rodar lint/typecheck e ajustar erros triviais.
- Quando não houver escopo minimamente definido.
- Quando o objetivo principal for corrigir código na mesma sessão sem priorizar relatório formal
  (nesse caso, usar `code-audit-and-fix`).

## Matriz de decisão rápida

- **`code-audit`**: diagnóstico profundo + relatório formal em duas partes (issues + upgrades).
- **`semantic-logic-audit`**: validação semântica de fluxo/invariante ponta a ponta (foco em
  lógica).
- **`code-audit-and-fix`**: descoberta + correção no mesmo ciclo com patches e validação.

## Inputs / Preconditions

Antes de auditar, obter:

1. Escopo explícito (arquivo, pasta, módulo ou fluxo).
2. Contexto de execução (Node.js, browser, worker, etc.).
3. Restrições de negócio relevantes para os caminhos críticos.
4. Se possível, expectativa de comportamento (o que “correto” significa no contexto).

Se o usuário não fornecer escopo, solicitar antes de começar.

## Workflow

### Passo 0 — Delimitar Escopo

Confirmar:

- Escopo exato.
- Limites fora de escopo.
- Objetivo da auditoria (confiabilidade, segurança, performance, manutenção etc.).

### Passo 1 — Leitura Integral e Mapeamento

Ler todos os arquivos do escopo **por completo** e mapear:

- Entidades principais (funções, classes, módulos exportados).
- Fluxo de controle (happy path + erro).
- Fluxo de dados (origem, transformação, consumo, persistência).
- Dependências externas e contratos assumidos.
- Invariantes explícitas e implícitas.

Use o checklist em `references/audit-checklist.md`.

### Passo 2 — Auditoria de Issues (Parte I)

Para cada achado real, registrar obrigatoriamente:

- ID (`BUG-001`, `INC-001`, `GAP-001`, `SEC-001`...)
- Arquivo/linhas
- Categoria
- Severidade (rubrica em `references/severity-rubric.md`)
- Título
- Descrição técnica detalhada
- Cenário de reprodução/manifestação (quando aplicável)
- Proposta de correção concreta
- Referências técnicas (quando necessário)

Critério de inclusão:

- Incluir somente problemas reais e não óbvios.
- Não incluir observações puramente cosméticas.

### Passo 3 — Análise de Upgrades (Parte II)

Depois dos issues, propor upgrades relevantes ao código auditado.

Use o catálogo em `references/upgrade-catalogue.md`.

Cada upgrade deve conter:

- ID (`UPG-001`, `UPG-002`...)
- Categoria
- Prioridade
- Motivação
- Implementação proposta
- Trade-offs/riscos

Regra:

- A skill deve sempre sugerir upgrades pertinentes, não lista genérica sem vínculo ao escopo.

### Passo 4 — Montagem do Relatório

Estruturar resposta com o template em `references/report-template.md`.

Obrigatório:

1. Sumário executivo (estado geral + urgência).
2. Tabela-resumo de issues/upgrades.
3. Parte I detalhada (issues).
4. Parte II detalhada (upgrades).
5. Conclusão com próximos passos priorizados.

### Passo 5 — Entrega e Continuação

Após entregar:

- Perguntar se o usuário quer aprofundar algum achado.
- Perguntar se deseja implementação imediata de correções ou upgrades.
- Se solicitado, migrar para skill de correção direta (`code-audit-and-fix`) para executar patches.

## Guardrails

- Evidência antes de conclusão: todo achado deve apontar linhas e fluxo causal.
- Sem inferência vaga: evitar “pode ser problema” sem cenário técnico.
- Profundidade > volume: preferir poucos achados sólidos a listas superficiais.
- Correções propostas devem ser acionáveis e minimamente testáveis.
- Não transformar auditoria em refatoração massiva sem justificativa.

## Validation / Done Criteria

Considere concluído quando:

- Escopo foi auditado integralmente.
- Parte I contém achados com evidência + proposta de correção.
- Parte II contém upgrades pertinentes e priorizados.
- Relatório final está estruturado e acionável.

## Related Skills

- `semantic-logic-audit`: auditoria semântica ampla orientada a fluxos e invariantes, especialmente
  para validação ponta a ponta de state machines e contratos de execução.
- `code-audit-and-fix`: quando o objetivo é auditar e já aplicar correções no mesmo ciclo.
- `reactive-bug-audit`: investigação de bug já observado com sintoma inicial.
- `exploratory-bug-hunt`: varredura proativa orientada a padrões.
