# R-07 — Programa 0: Governança e Baseline

**Programa**: P0 **Objetivo**: estabilizar a base factual, a navegação documental e os gates mínimos
antes das ondas profundas de rearquitetura

---

## 1. Por que este programa existe

Sem um baseline bem medido e governado, qualquer rearquitetura grande corre o risco de virar uma
mistura de:

- melhorias reais;
- regressões silenciosas;
- mudanças não comparáveis entre si;
- documentação que envelhece mais rápido do que o código.

P0 existe para impedir exatamente isso.

---

## 1.1 Estado materializado em 2026-04-16

As fases principais de P0 deixaram de ser apenas intenção e passaram a ter artefatos canônicos
dedicados:

- [`R-04A-ENDSTATE-E-CRITERIOS-DE-SUCESSO.md`](./R-04A-ENDSTATE-E-CRITERIOS-DE-SUCESSO.md) — end-state explícito e régua de convergência da arquitetura-alvo;
- [`R-07A-TABELA-BASE-OFICIAL.md`](./R-07A-TABELA-BASE-OFICIAL.md) — baseline factual do ciclo
  clean;
- [`R-07B-MATRIZ-DE-OWNERSHIP-E-CONTRATOS.md`](./R-07B-MATRIZ-DE-OWNERSHIP-E-CONTRATOS.md) —
  ownership e contratos de topo;
- [`R-07C-FRONTEIRAS-E-COMPATIBILIDADE-RESIDUAL.md`](./R-07C-FRONTEIRAS-E-COMPATIBILIDADE-RESIDUAL.md)
  — regras de camada e registro canônico de compat residual;
- [`R-07D-GATES-SUITES-E-RISCO-OPERACIONAL.md`](./R-07D-GATES-SUITES-E-RISCO-OPERACIONAL.md) —
  quality gates, security gates, suites mínimas e baseline de risco.

Leitura prática do estado atual de P0:

- **F0.1** materializada;
- **F0.2** materializada no hub clean e em suas pontes centrais;
- **F0.3** materializada;
- **F0.4** materializada;
- **F0.5** parcialmente materializada, dividida entre `R-04A`, `R-05`, `R-15` e o registro de compatibilidade
  residual de `R-07C`.

---

## 2. Escopo

P0 cobre:

- baseline quantitativo e qualitativo;
- índices e hubs documentais;
- matriz de ownership e contratos de topo;
- gates mínimos de qualidade e segurança;
- registro de dívida residual e deprecações.

---

## 3. Fases

## F0.1 — congelamento do baseline factual

### Subfases

- F0.1.a — medir LOC, arquivos e hotspots por módulo
- F0.1.b — medir imports transversais relevantes (`sdk`, `observability`, `agent`,
  `server ↔ terminal`)
- F0.1.c — registrar backlog residual de deprecateds, TODOs e catches silenciosos
- F0.1.d — definir tabela de métricas-base para comparação futura

### Entregas

- tabela-base por módulo
- tabela-base de fan-in/fan-out estrutural
- tabela-base de dívida residual

## F0.2 — governança documental canônica

### Subfases

- F0.2.a — declarar esta série clean como hub operacional
- F0.2.b — mapear o acervo legado para a série nova
- F0.2.c — atualizar documentos antigos pertinentes com ponte mínima para a nova linha
- F0.2.d — definir regra de manutenção entre docs ativos e históricos

### Entregas

- hub `README.md`
- anexo de mapeamento legado → novo plano
- notas de sucessão nos documentos antigos mais críticos

## F0.3 — ownership e contratos de topo

### Subfases

- F0.3.a — registrar ownership por módulo principal
- F0.3.b — definir fronteiras de camada e imports permitidos/indesejados
- F0.3.c — mapear contratos públicos de runtime (`agent`, `sdk`, `server`, `terminal`, `channel`,
  `hub`)
- F0.3.d — definir quais shims/compatibilidades são temporários e quais são canônicos

### Entregas

- matriz de ownership
- mapa de fronteiras por camada
- registro de compatibilidade residual

## F0.4 — baseline de qualidade e segurança

### Subfases

- F0.4.a — definir quality gates mínimos por onda
- F0.4.b — definir security gates mínimos por superfície crítica
- F0.4.c — alinhar quais validações são mandatórias por tipo de mudança
- F0.4.d — formalizar que documentação, testes e typing fazem parte do done

### Entregas

- tabela de quality gates por programa
- tabela de security gates por domínio

## F0.5 — registro de dívida e critério de priorização

### Subfases

- F0.5.a — abrir registro de deprecateds e dead code
- F0.5.b — abrir registro de gaps estruturais de alto risco
- F0.5.c — separar backlog estrutural de backlog de capabilities
- F0.5.d — definir regra de prioridade entre risco, impacto e dependência

### Entregas

- backlog estrutural consolidado
- backlog de capacidades avançadas separado

---

## 4. Critérios de conclusão

- baseline quantitativo oficial documentado;
- hubs documentais canônicos definidos;
- ponte clara entre acervo legado e nova linha clean;
- critérios mínimos de quality/security gate por programa;
- registro de dívida residual pronto para orientar as próximas ondas.

### Critério operacional adicional

Se um checkpoint alterar números-base de `src/copilot/`, ownership de módulo ou status de compat
residual e **não** atualizar `R-07A`–`R-07D`, o ciclo de P0 deve ser considerado incompleto.

---

## 5. Riscos se P0 for pulado

- reabertura constante de debates já resolvidos;
- disputa entre documentos antigos e novos;
- incapacidade de provar se uma onda melhorou ou piorou a arquitetura;
- backlog estrutural e capabilities futuras continuando misturados.

---

## 6. Resultado esperado

Ao concluir P0, a equipe passa a ter uma base simples para responder, a qualquer momento:

- onde estamos;
- qual documento manda;
- o que ainda falta;
- o que é dívida estrutural;
- e o que é capacidade futura opcional.
