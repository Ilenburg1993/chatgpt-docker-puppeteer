# Relatório de Análise e Criação da Skill `code-audit`

## Objetivo

Consolidar a proposta em `DOCUMENTAÇÃO/PLANOS/SKILL_PROPOSTO.MD`, alinhar com o ecossistema atual de
skills do repositório e com a documentação oficial aplicável, e entregar a skill completa
`.github/skills/code-audit/`.

## Fontes analisadas

### Internas (repositório)

- `DOCUMENTAÇÃO/PLANOS/SKILL_PROPOSTO.MD`
- `.github/skills/code-audit-and-fix/SKILL.md`
- `.github/skills/semantic-logic-audit/SKILL.md`
- `.github/skills/README.md`
- `.github/skills/skill-creator-pt-br/SKILL.md`

### Oficiais (externas)

- GitHub Docs — custom instructions e precedência:
  - https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions
  - https://docs.github.com/en/copilot/reference/custom-instructions-support
  - https://docs.github.com/en/copilot/concepts/prompting/response-customization
- VS Code Docs — skills e customizações:
  - https://code.visualstudio.com/docs/copilot/customization/agent-skills
  - https://code.visualstudio.com/docs/copilot/customization/custom-instructions
- Agent Skills (padrão aberto):
  - https://agentskills.io/specification
  - https://agentskills.io/skill-creation/best-practices
  - https://agentskills.io/what-are-skills

## Síntese técnica da proposta

A proposta define uma skill de auditoria **manual e semântica**, com as seguintes exigências-chave:

1. Proibição explícita de ferramentas automáticas de análise para decisão de achados.
2. Escopo obrigatório antes da auditoria.
3. Relatório em duas partes:
   - Parte I: Issues com severidade, evidência e proposta de correção.
   - Parte II: Upgrades pertinentes ao contexto auditado.
4. Entrega em formato estruturado e acionável.

## Análise de sobreposição com skills existentes

### Relação com `semantic-logic-audit`

- Interseção: ambas focam em leitura profunda e semântica.
- Diferença proposta para `code-audit`:
  - saída padronizada com template formal de relatório;
  - obrigação explícita de seção de upgrades;
  - checklist/rubrica/catálogo anexos para execução repetível.

### Relação com `code-audit-and-fix`

- `code-audit-and-fix` prioriza ciclo descoberta + correção + validação executável.
- `code-audit` (nova) prioriza diagnóstico profundo e priorização técnica, sem obrigatoriedade de
  aplicar patches no mesmo ciclo.

## Decisões de design adotadas

1. Criar skill dedicada em `.github/skills/code-audit/`.
2. Manter `SKILL.md` com fluxo enxuto e orientado a procedimento.
3. Mover conteúdo extenso para `references/` (progressive disclosure).
4. Incluir `agents/openai.yaml` para exposição consistente da skill no ecossistema local.
5. Reforçar distinção de escopo em relação às skills já existentes.

## Entregáveis criados

- `.github/skills/code-audit/SKILL.md`
- `.github/skills/code-audit/references/audit-checklist.md`
- `.github/skills/code-audit/references/severity-rubric.md`
- `.github/skills/code-audit/references/upgrade-catalogue.md`
- `.github/skills/code-audit/references/report-template.md`
- `.github/skills/code-audit/agents/openai.yaml`

## Conformidade com documentação oficial

- Estrutura `SKILL.md` + diretório de recursos segue Agent Skills specification.
- Organização do conteúdo adota abordagem de progressive disclosure (core no `SKILL.md`, detalhes em
  `references/`).
- Metadados e descrição foram redigidos para facilitar descoberta/ativação da skill por relevância.

## Riscos e mitigação

- **Risco:** sobreposição semântica com `semantic-logic-audit`.
  - **Mitigação:** posicionamento explícito da nova skill como auditoria com output formal em duas
    partes (issues + upgrades).
- **Risco:** auditoria excessivamente subjetiva.
  - **Mitigação:** checklist objetivo, rubrica de severidade e template padronizado.

## Próximos passos recomendados

1. Adicionar referência da `code-audit` no catálogo de skills (`.github/skills/README.md`).
2. Rodar sessão piloto de auditoria real usando a nova skill e coletar feedback.
3. Iterar no checklist/rubrica com base nos primeiros relatórios produzidos.

## Propostas de posicionamento (revisão completa)

### Matriz de roteamento entre skills similares

| Cenário principal                                                     | Skill recomendada      | Motivo                                                           |
| --------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------- |
| Preciso de diagnóstico profundo com artefato formal para compartilhar | `code-audit`           | Entrega obrigatória em duas partes (issues + upgrades)           |
| Preciso validar se um fluxo crítico está correto ponta a ponta        | `semantic-logic-audit` | Ênfase em invariantes, transições de estado e contratos de fluxo |
| Preciso encontrar e já corrigir bugs nesta sessão                     | `code-audit-and-fix`   | Ciclo completo com patches e validação                           |

### Sinais de ativação recomendados

- **`code-audit`**: “auditar módulo”, “quero relatório”, “priorizar riscos”, “mapear upgrades”.
- **`semantic-logic-audit`**: “validar lógica”, “fluxo completo”, “invariante”, “state machine”.
- **`code-audit-and-fix`**: “encontre e corrija”, “aplica patch”, “resolver agora com testes”.

### Fronteiras para reduzir ambiguidade

1. `code-audit` deve sempre reforçar perfil `diagnosis_first`.
2. `semantic-logic-audit` deve evitar assumir entrega formal se o usuário não pedir relatório.
3. `code-audit-and-fix` deve evitar abrir com long-form report quando há urgência de correção.
