---
name: code-audit
description: >
  Realiza auditoria manual e aprofundada de uma porção de código especificada pelo usuário.
  Identifica bugs, incompletudes, gaps lógicos e falhas semânticas que ferramentas automáticas
  (ESLint, TSServer, Prettier, Biome, SonarQube etc.) são incapazes de detectar.
  Gera um relatório Markdown estruturado com severidade, descrição completa e proposta de correção
  para cada achado. Inclui também uma segunda parte dedicada a upgrades pertinentes.
  Use este skill sempre que o usuário pedir "audite", "revise profundamente", "analise bugs",
  "faça uma revisão de código", "encontre problemas no código", "code review", "auditoria" ou
  variações. Acionar também quando o usuário mencionar suspeita de bugs sutis, problemas de
  performance, falhas de segurança ou desejo de modernizar uma parte específica do código.
user-invocable: true
---

# Code Audit — Auditoria Manual Profunda de Código

> **Regra absoluta e inegociável:** Este skill proíbe completamente o uso de qualquer ferramenta
> de análise estática, linter, type-checker ou formatador durante a auditoria. Isso inclui, mas
> não se limita a: ESLint, TSServer/TypeScript compiler, Prettier, Biome, Oxlint, SonarQube,
> Semgrep, CodeQL, Bandit, Pylint, Flake8, mypy, Clippy, RuboCop, Checkstyle e similares.
> **A auditoria é inteiramente manual, baseada em raciocínio semântico e lógico.**

---

## Propósito

As ferramentas automáticas capturam violações de estilo, erros de tipo triviais e padrões
proibidos explicitamente configurados. O que elas **não capturam** é o que importa nesta
auditoria: raciocínio incorreto, suposições silenciosamente inválidas, contratos de API
violados semanticamente, estados inalcançáveis ou irrecuperáveis, condições de corrida
implícitas, vazamentos de recursos, e gaps arquiteturais que só emergem quando o código é
lido como um sistema, não como uma sequência de tokens.

---

## Passo 0 — Determinação do Escopo

Antes de iniciar qualquer análise, solicite ao usuário que especifique exatamente qual porção
do código será auditada. O escopo pode ser:

- Um arquivo específico (ex.: `src/services/auth.ts`)
- Um diretório (ex.: `src/hooks/`)
- Um módulo ou feature (ex.: "todo o fluxo de autenticação")
- Uma função ou classe isolada

Se o usuário já especificou o escopo na mensagem, prossiga diretamente para o Passo 1.
Se não especificou, pergunte antes de prosseguir — **não inicie a auditoria sem escopo definido.**

Confirme com o usuário:
1. O escopo exato (arquivos/diretórios)
2. O contexto de execução (Node.js, browser, edge runtime, etc.)
3. A linguagem/runtime principal
4. Se há restrições conhecidas de negócio que o auditor deve considerar

---

## Passo 1 — Leitura Integral e Mapeamento Estrutural

Leia **na íntegra** todos os arquivos do escopo definido. Não audite enquanto lê.
Construa primeiro um mapa mental do código:

- **Entidades principais**: funções, classes, módulos exportados, tipos/interfaces
- **Fluxo de controle**: caminhos felizes, caminhos de erro, branches condicionais
- **Fluxo de dados**: de onde vêm os dados, como são transformados, para onde vão
- **Dependências externas**: o que é importado, quais contratos externos são assumidos
- **Invariantes implícitas**: o que o código assume que sempre será verdade

Anote, mas não escreva o relatório ainda.

---

## Passo 2 — Auditoria de Issues (Parte I do Relatório)

Aplique sistematicamente cada categoria do checklist em
[`references/audit-checklist.md`](./references/audit-checklist.md).

Para **cada issue identificada**, registre:

| Campo                  | Descrição                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `ID`                   | Código único: `BUG-001`, `INC-001`, `GAP-001`, `SEC-001` etc.                       |
| `Arquivo`              | Caminho relativo + número(s) de linha                                               |
| `Categoria`            | Ver categorias no checklist                                                         |
| `Severidade`           | Ver rubrica em [`references/severity-rubric.md`](./references/severity-rubric.md)   |
| `Título`               | Uma frase precisa descrevendo o problema                                            |
| `Descrição`            | Explicação completa: o que está errado, por que está errado, em que condições falha |
| `Reprodução`           | Cenário mínimo que demonstra a falha (se aplicável)                                 |
| `Proposta de Correção` | Código corrigido ou descrição detalhada da correção                                 |
| `Referências`          | Links ou citações de specs/RFCs/docs relevantes (quando pertinente)                 |

**Critério de inclusão:** Inclua um issue somente se ele representa um problema real e
não-óbvio. Não inclua itens que qualquer linter comum detectaria.

---

## Passo 3 — Análise de Upgrades (Parte II do Relatório)

Após a auditoria de issues, execute uma análise orientada a oportunidades. Consulte o
catálogo em [`references/upgrade-catalogue.md`](./references/upgrade-catalogue.md).

Para **cada upgrade proposto**, registre:

| Campo           | Descrição                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------- |
| `ID`            | Código único: `UPG-001`, `UPG-002` etc.                                                     |
| `Arquivo`       | Caminho relativo + número(s) de linha (se aplicável)                                        |
| `Categoria`     | Performance / Segurança / Manutenibilidade / Modernização / Testabilidade / Observabilidade |
| `Prioridade`    | Alta / Média / Baixa                                                                        |
| `Título`        | Uma frase descrevendo o upgrade                                                             |
| `Motivação`     | Por que este upgrade agrega valor ao código existente                                       |
| `Implementação` | Código ou passos detalhados para implementar o upgrade                                      |
| `Trade-offs`    | Riscos ou custos da mudança, se houver                                                      |

**Critério de inclusão:** Somente upgrades pertinentes ao código existente. Não proponha
refatorações abstratas ou mudanças de paradigma sem evidência de que seriam benéficas
para este código específico. Deve necessariamente sugerir upgrades.

---

## Passo 4 — Geração do Relatório

Use o template em [`references/report-template.md`](./references/report-template.md)
para estruturar o relatório final.

O relatório deve:

1. Iniciar com um **sumário executivo** (máximo 5 parágrafos) descrevendo a saúde geral
   do código ou parte do código solicitado, o padrão recorrente de problemas encontrados e o nível de urgência geral
2. Apresentar uma **tabela de resumo** com todos os issues e upgrades identificados,
   ordenados por severidade/prioridade
3. Desenvolver cada issue em detalhe na **Parte I**
4. Desenvolver cada upgrade em detalhe na **Parte II**
5. Encerrar com uma **seção de conclusão** indicando os próximos passos recomendados
   em ordem de prioridade

---

## Passo 5 — Entrega e Revisão

Entregue o relatório como um bloco Markdown completo na resposta ao usuário,
ou como arquivo `audit-report.md` se o usuário preferir.

Após a entrega, pergunte ao usuário:
- Se deseja aprofundamento em algum issue específico
- Se deseja que algum upgrade seja implementado imediatamente
- Se há contexto adicional que possa alterar algum dos achados

---

## Regras de Conduta da Auditoria

1. **Nenhuma ferramenta automática** — ver regra absoluta no início deste documento
2. **Evidência primeiro** — cada achado deve citar linha(s) de código específicas
3. **Sem falsos positivos por estilo** — issues de formatação/nomenclatura não são auditáveis
   por este skill; foque em semântica, lógica e contratos
4. **Profundidade sobre volume** — 5 issues precisos valem mais que 20 observações vagas
5. **Propostas concretas** — toda issue deve ter proposta de correção acionável
6. **Upgrades pertinentes** — proponha apenas o que faz sentido para o código em questão,
   não uma lista genérica de boas práticas
7. **Tom técnico e preciso** — o relatório é um documento de engenharia, não um comentário
   de code review informal
