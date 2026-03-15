# Catálogo de Upgrades Pertinentes

Este catálogo guia a Parte II do relatório (upgrades). Use apenas itens com aderência real ao escopo
analisado.

## Categorias e gatilhos

### 1) Performance

Propor quando houver:

- Recomputação evitável em caminho quente.
- Estruturas de dados inadequadas para a escala esperada.
- Padrões N+1, loops redundantes ou I/O excessivo.

Sugestões típicas:

- Cache com estratégia explícita de invalidação.
- Redução de round-trips e consolidação de operações.
- Melhorias de algoritmo/estrutura com análise de trade-off.

### 2) Segurança

Propor quando houver:

- Superfície de entrada sem validação robusta.
- Risco de exposição de segredo em logs/erros.
- Falhas de autorização/autenticação por ordem de checagem.

Sugestões típicas:

- Hardening de validação de input e sanitização.
- Separação de mensagens para usuário e diagnóstico interno.
- Revisão de boundary de autorização por recurso/operação.

### 3) Manutenibilidade

Propor quando houver:

- Acoplamento alto e baixa legibilidade de fluxo crítico.
- Duplicação de lógica sensível com risco de divergência.
- Contratos implícitos não documentados.

Sugestões típicas:

- Extração de componentes coesos.
- Centralização de validações/regras de domínio.
- Clarificação de contratos com tipos/documentação objetiva.

### 4) Modernização técnica

Propor quando houver:

- APIs obsoletas ou padrões legados com risco de continuidade.
- Dependência de comportamento deprecated.
- Custo operacional elevado por escolhas antigas.

Sugestões típicas:

- Migração gradual para APIs modernas.
- Simplificação de camadas intermediárias sem valor atual.
- Adoção de práticas atuais de runtime/observabilidade.

### 5) Testabilidade

Propor quando houver:

- Fluxos críticos sem pontos adequados para teste.
- Dependência excessiva de side effects para validar comportamento.
- Cobertura fraca de cenários de erro/recovery.

Sugestões típicas:

- Introdução de seams e injeção de dependência onde necessário.
- Casos de teste orientados a invariantes e transições de estado.
- Fixtures/mocks de alto valor para cenários críticos.

### 6) Observabilidade

Propor quando houver:

- Diagnóstico difícil por falta de contexto em logs/eventos.
- Ausência de correlação entre etapas do fluxo.
- Métricas insuficientes para detectar degradação.

Sugestões típicas:

- IDs de correlação em operações distribuídas.
- Telemetria de latência, erro e throughput por etapa.
- Eventos de domínio para marcos críticos de execução.

## Regras de qualidade para upgrades

Todo upgrade deve incluir:

1. **Motivação concreta** vinculada ao código auditado.
2. **Implementação proposta** (passos claros ou snippet conceitual).
3. **Trade-offs** (custo, risco, impacto de adoção).
4. **Prioridade** (Alta/Média/Baixa) com justificativa.

Evite upgrades genéricos sem ligação com evidências do escopo.
