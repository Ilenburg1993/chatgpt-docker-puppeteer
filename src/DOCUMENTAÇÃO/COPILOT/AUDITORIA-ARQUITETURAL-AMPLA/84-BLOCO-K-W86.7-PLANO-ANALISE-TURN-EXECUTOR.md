# 84 — Bloco K / W86.7: plano contínuo de análise e decomposição de turn-executor

**Data:** 2026-04-30 **Dependência:** conclusão da W86.6.3 (session-bootstrap-state seam)
**Status:** 📋 PLANEJAMENTO

---

## 1) Objetivo da onda

Analisar e reduzir densidade do módulo `turn-executor.js` (~947 LOC) através de extração de seams
semânticos cohesivos, priorizando:

1. lógica de validação/pré-processamento de turnos
2. lógica de contexto/modelo de execução
3. lógica de pós-processamento/persistência

---

## 2) Escopo técnico alvo

**Arquivo principal:** `src/copilot/agent/dialog/turn-executor.js` (947 LOC)

**Funções candidatas para extração** (investigação):

- pré-processamento: `validateTurnInput()`, `prepareTurnContext()`, etc.
- execução-principal: `executeTurn()`, callbacks de processamento
- pós-processamento: `persistTurnResult()`, `updateDialogState()`, etc.

**Estrutura de seams proposta**:

```
agent/dialog/
├── turn-executor.js              [façade/orquestrador refatorado]
├── seams/
│   ├── turn-input-validation.js   [W86.7.1: validação e pré-prep]
│   ├── turn-execution-context.js  [W86.7.2: contexto de modelo/run]
│   └── turn-result-persistence.js [W86.7.3: pós-proc e persistência]
```

---

## 3) Critérios claros de conclusão

### Critério W86.7-A — decomposição funcional

- seams identificados e funções alvo mapeadas com justificativa semântica
- cada seam tem cohesão interna clara e dependências explícitas

### Critério W86.7-B — compatibilidade estável

- assinatura pública de `turn-executor` preservada
- consumidores (loop-manager, dialog lifecycle) não sofrem breaking changes

### Critério W86.7-C — anti-regressão

- contratos adicionados em `test_arch_contracts` para cada sub-seam
- delegation pattern validado via assertions

### Critério W86.7-D — métrica de densidade

- fan-in/fan-out do executor reduzido (alvo: -30% arestas de entrada)
- cada sub-seam tem fanIn ≤ 2 (executor + possível consumidor secundário)

### Critério W86.7-E — integridade mínima

- `node --check` verde em todos os arquivos alterados
- sem introdução de imports cruzados entre seams

---

## 4) Método de investigação (pré-work)

1. **Leitura profunda** de `turn-executor.js`: identificar funções internas, helpers, contexto
2. **Análise de fluxo**: traçar percurso da entrada (turnInput) até saída (turnResult)
3. **Clustering semântico**: agrupar funções por domínio (validação, execução, persistência)
4. **Mapeamento de dependências**: quem chama o quê dentro do módulo
5. **Avaliação de viabilidade**: priorizar seams com ganho real de cohesão vs. custo de abstração

---

## 5) Próximo passo imediato

1. Implementar W86.7.1 (turn-input-validation seam) como prototipagem
2. Validar padrão de delegação
3. Avaliar ganho de densidade antes de W86.7.2 e W86.7.3
4. Se padrão for sólido, continuar com 2 e 3 em paralelo/sequência
5. Se houver bloqueadores, reportar e ajustar estratégia antes de W87

---

## 6) Notas operacionais

- **Prototipagem esperada**: W86.7 pode revelar necessidade de refactor upstream em
  `loop-manager.js` ou `dialog-runtime`
- **Padrão estabelecido**: usar mesma estrutura (new seam file + Impl import + delegation +
  contract + checkpoint)
- **Escalabilidade**: se W86.7 funcionar, padrão pode ser aplicado a outros hotspots
  (`agent/state/*`, `agent/messaging/*`)

---

**Plano emitido:** 2026-04-30 **Autor:** Copilot Agent (W86 continuous execution) **Próximo:**
Execução W86.7.1 após aprovação/confirmação
