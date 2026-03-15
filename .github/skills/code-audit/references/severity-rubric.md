# Rubrica de Severidade

Use esta rubrica para classificar issues da Parte I.

## Níveis

| Severidade  | Critério principal                                         | Impacto típico                                                                       | Ação recomendada                          |
| ----------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------- |
| **Crítica** | Falha grave com alto potencial de dano imediato            | corrupção de dados, violação séria de segurança, indisponibilidade ampla             | tratar antes de qualquer item não crítico |
| **Alta**    | Falha relevante com impacto frequente ou de alto custo     | perda parcial de funcionalidade, inconsistência de estado, risco elevado em produção | priorizar no próximo ciclo imediato       |
| **Média**   | Falha real com impacto moderado e contornável              | bugs intermitentes, degradação, dívida operacional crescente                         | corrigir em curto prazo com planejamento  |
| **Baixa**   | Falha de baixo impacto, baixa frequência ou fácil contorno | ruído operacional, pequenos riscos de manutenção                                     | programar quando houver janela            |
| **Info**    | Observação técnica sem falha comprovada                    | atenção arquitetural, oportunidade de prevenção                                      | registrar para acompanhamento             |

## Regras práticas de classificação

### Classifique como **Crítica** quando houver pelo menos um:

- Risco de exploração de segurança com impacto substancial.
- Corrupção/perda irreversível de dados.
- Estado inconsistente que inviabiliza recuperação confiável.

### Classifique como **Alta** quando houver:

- Falha funcional em fluxo central de negócio.
- Inconsistência relevante com chance alta de recorrência.
- Erro que pode escalar para incidente sem mitigação rápida.

### Classifique como **Média** quando houver:

- Problema que não quebra o sistema inteiro, mas compromete previsibilidade.
- Erro em fluxo secundário com impacto mensurável.

### Classifique como **Baixa** quando houver:

- Problema válido, porém raro e de baixo custo operacional.
- Ajuste importante para robustez futura, sem urgência imediata.

### Classifique como **Info** quando:

- Não existe falha confirmada, mas há hipótese técnica com recomendação preventiva.

## Critérios auxiliares (desempate)

Em caso de dúvida entre dois níveis, avalie:

1. **Probabilidade** de ocorrência no ambiente real.
2. **Amplitude** do impacto (quantos fluxos/usuários).
3. **Detectabilidade** (fácil/difícil identificar rapidamente).
4. **Recuperabilidade** (simples/complexa/reversível/irreversível).

Escolha o nível mais conservador quando houver incerteza relevante.
