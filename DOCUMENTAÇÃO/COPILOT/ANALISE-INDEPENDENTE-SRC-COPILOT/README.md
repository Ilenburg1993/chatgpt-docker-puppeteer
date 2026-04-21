# Análise Independente de `src/copilot`

**Data-base**: 2026-04-17 **Escopo**: árvore real de `src/copilot/`, lida e medida diretamente a
partir do código **Objetivo**: oferecer uma leitura arquitetural completa, didática e independente
da linha documental existente.

## Como ler esta série

Esta série não parte do roadmap atual; ela parte do código.

Ela responde, em ordem, às perguntas:

1. **o que existe hoje?**
2. **como isso se conecta?**
3. **como os fluxos realmente funcionam?**
4. **onde as fronteiras estão borradas ou duplicadas?**
5. **qual deveria ser a arquitetura-alvo?**
6. **como transformar o sistema sem perder controle?**

## Documentos

| Documento                                                                                      | Papel                                                                    |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [`00-SUMARIO-EXECUTIVO.md`](./00-SUMARIO-EXECUTIVO.md)                                         | visão executiva do diagnóstico                                           |
| [`01-INVENTARIO-ESTRUTURAL.md`](./01-INVENTARIO-ESTRUTURAL.md)                                 | inventário completo de módulos, subpastas e arquivos                     |
| [`02-GRAFOS-E-ACOPLAMENTOS.md`](./02-GRAFOS-E-ACOPLAMENTOS.md)                                 | análise objetiva de dependências, centralidade e smells                  |
| [`03-FLUXOS-E-CICLOS.md`](./03-FLUXOS-E-CICLOS.md)                                             | fluxos reais de bootstrap, runtime, transporte, sessão e observabilidade |
| [`04-AS-IS-FRONTEIRAS-GAPS-E-DUPLICACOES.md`](./04-AS-IS-FRONTEIRAS-GAPS-E-DUPLICACOES.md)     | avaliação crítica do estado atual                                        |
| [`05-ARQUITETURA-ALVO-E-ENDSTATE.md`](./05-ARQUITETURA-ALVO-E-ENDSTATE.md)                     | arquitetura ideal proposta e critérios de sucesso                        |
| [`06-ROADMAP-INDEPENDENTE-DE-TRANSFORMACAO.md`](./06-ROADMAP-INDEPENDENTE-DE-TRANSFORMACAO.md) | roadmap derivado desta análise                                           |
| [`07-CRITERIOS-DE-SUCESSO-POR-ASPECTO.md`](./07-CRITERIOS-DE-SUCESSO-POR-ASPECTO.md)           | critérios objetivos por aspecto arquitetural                             |
| [`08-MODULO-PRIORITARIO-OBSERVABILITY.md`](./08-MODULO-PRIORITARIO-OBSERVABILITY.md)           | investigação profunda do módulo prioritário                              |

## Leituras centrais desta análise

- `src/copilot/` hoje é um sistema grande e funcional, mas ainda com sinais fortes de
  **centralização acidental** em alguns subsistemas.
- `agent/`, `sdk/`, `tools/`, `terminal/` e `observability/` já operam como macro-blocos
  arquiteturais.
- `presentation/` surgiu como correção arquitetural importante, mas ainda é uma camada **em
  consolidação**, não um fim de jornada.
- `terminal/` já pode ser tratado como **frontend principal da LLM-B**, mas ainda precisa terminar a
  convergência interna para não continuar carregando orchestration residual.
- `observability/` segue sendo o maior polo de acoplamento transversal do sistema.

## Notas metodológicas

- Os dados desta série foram extraídos do código-fonte e de medições locais de estrutura/imports.
- A análise considera também diretórios transitórios e compat shims, porque eles impactam a
  arquitetura real, mesmo quando marcados como legados.
- A pasta `src/copilot/logs/` foi tratada como **artefato operacional**, não como camada de
  código-fonte.
