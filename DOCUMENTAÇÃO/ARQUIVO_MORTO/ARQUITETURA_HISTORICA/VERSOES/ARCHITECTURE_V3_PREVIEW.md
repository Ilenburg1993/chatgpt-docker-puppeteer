> **Status**: Histórico **Este documento está arquivado** e não define o baseline oficial.
> **Referência vigente**:
> [../../../ARQUITETURA/ARCHITECTURE.md](../../../ARQUITETURA/ARCHITECTURE.md).

# 🏗️ Arquitetura do Sistema (v3.0 - Mission-Oriented)

**Versão**: 3.0 (Mission-Oriented Architecture) **Última Atualização**: 01/02/2026  
**Público-Alvo**: Desenvolvedores iniciantes, intermediários e avançados **Tempo de Leitura**:
~60-90 min (navegação modular) **Linhas Totais**: 2,800+ linhas técnicas

---

## 📖 Visão Geral Executiva

O **chatgpt-docker-puppeteer** é uma **plataforma de orquestração autônoma de LLMs** que executa
**missões complexas de longa duração** (horas/dias) com mínima intervenção humana. Diferentemente de
executores simples de tarefas isoladas, este sistema foi projetado para sustentar **trabalho
contínuo e iterativo** com validação de qualidade automática, recuperação de falhas e feedback
humano quando necessário.

### 🎯 Objetivo Central (Redefinido v3.0)

**❌ NÃO**: Executar centenas de tarefas isoladas simultaneamente  
**✅ SIM**: Sustentar **missões autônomas de longo prazo**

**Exemplo Prático**: Escrever livro técnico de 300 páginas em 4-6 horas

- 15 capítulos gerados automaticamente
- 87 tasks executadas (45 iterações de chapters + steps auxiliares)
- 12 retries automáticos (quality < 75%)
- 1-2 feedbacks humanos (98% autonomia)
- Custo: ~$5-8 USD (GPT-4), output: 312 páginas

### 🧠 Filosofia Core

| Princípio                    | Implementação                          | Benefício                                |
| ---------------------------- | -------------------------------------- | ---------------------------------------- |
| **Autonomia > Concorrência** | 1 missão completa > 100 tasks isoladas | Trabalho contínuo sem supervisão         |
| **IA como Executor**         | LLM executa 98% do trabalho técnico    | Liberação humana para supervisão         |
| **Humano como Orientador**   | Correções de rota, ajustes de contexto | Qualidade mantida com mínima intervenção |
| **Iteração Automática**      | Retry até quality threshold (75%+)     | Convergência para qualidade alta         |
| **Crash Recovery**           | Checkpoints periódicos (<5min perda)   | Tolerância a falhas transparente         |
| **Observabilidade Total**    | Every action tracked via NERV          | Debug facilitado, rastreamento E2E       |
