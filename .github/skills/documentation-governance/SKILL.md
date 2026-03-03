---
name: documentation-governance
description:
  Use esta skill quando o trabalho envolver auditoria, reorganização, atualização de status,
  taxonomia, índices canônicos ou governança contínua da documentação do projeto.
license: MIT
---

# Overview

Esta skill orienta trabalho de governança documental em escala de repositório.

Ela deve ser usada quando a tarefa envolver:

- auditar o estado da documentação;
- consolidar status, lacunas e pendências;
- reorganizar hubs, índices e taxonomia;
- alinhar documentação oficial com a árvore real do código;
- atualizar o status geral e o plano documental;
- reduzir ambiguidade entre material canônico, especializado e histórico.

# When To Use

Use esta skill quando o pedido envolver qualquer uma destas situações:

- “auditar a documentação”
- “atualizar o status geral da documentação”
- “reorganizar a documentação”
- “criar ou revisar índices/hubs”
- “definir o que falta documentar”
- “padronizar a governança documental”

# When Not To Use

Não use esta skill quando:

- a tarefa for apenas editar um documento isolado sem impacto estrutural;
- o pedido for puramente de código, testes ou runtime;
- o foco for criar `README`s padronizados por pasta, caso em que a skill correta é
  `readme-standardization`.

# Inputs / Preconditions

Antes de executar:

- localizar os hubs canônicos (`DOCUMENTAÇÃO/README.md`, `DOCUMENTAÇÃO/INDEX.md`);
- entender a taxonomia atual de `DOCUMENTAÇÃO/`;
- verificar a árvore real do código quando a documentação depender dela;
- diferenciar material canônico, especializado e histórico.

Quando a auditoria for transversal:

- levantar contagem de diretórios e Markdown;
- mapear quais diretórios já têm `README.md`;
- identificar lacunas de navegação e cobertura.

# Workflow

1. Levantar o inventário da documentação viva e histórica.
2. Identificar o que já está consolidado, o que está parcial e o que está faltando.
3. Consolidar um relatório canônico de status com decisões, pendências, riscos e próximos passos.
4. Atualizar hubs e índices para apontarem para o novo estado consolidado.
5. Registrar estratégia por ondas quando a próxima fase for grande demais para um ataque único.
6. Manter a distinção entre:
   - documentação viva;
   - material especializado;
   - arquivo morto.

# Guardrails

- Não mover conteúdo histórico de volta para a navegação ativa sem justificativa explícita.
- Não criar novas taxonomias paralelas se a atual já puder ser fortalecida.
- Não tratar `README`s locais como substitutos do hub canônico.
- Não duplicar conteúdo extenso quando um índice com links resolver o problema.
- Sempre explicitar o que já foi feito, o que falta e qual é a próxima fase recomendada.

# Validation / Done Criteria

O trabalho está completo quando:

- existe um documento canônico de status consolidado;
- hubs e índices apontam para esse documento;
- as lacunas mais importantes estão classificadas por prioridade;
- a estratégia futura está organizada em ondas ou fases;
- o resultado permite continuidade sem reabrir a discussão estrutural do zero.

# Related Skills

- `readme-standardization`: usar na fase de criação de `README`s por pasta.
- `audit-system-analysis-planning`: usar quando a auditoria for mais arquitetural do que documental.
- `skill-creator-pt-br`: usar para criar ou evoluir skills adicionais de governança.
