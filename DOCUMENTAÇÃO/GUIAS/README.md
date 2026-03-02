# GUIAS

**Propósito**: concentrar a documentação de uso diário, onboarding, desenvolvimento, testes e
troubleshooting do projeto.  
**Status documental**: Canônico.  
**Público**: engenharia, onboarding técnico, manutenção e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## O que esta pasta contém

- guias de entrada rápida e setup inicial;
- rotas de desenvolvimento local;
- documentação de testes e práticas de validação;
- troubleshooting operacional de ambiente;
- guias específicos de plataforma quando o uso é recorrente.

## O que não deve ficar aqui

- documentação estrutural profunda de arquitetura;
- referência de API, configuração e contratos formais;
- planos ativos, propostas ou relatórios de análise;
- material histórico que já não serve como guia de uso vivo.

## Entradas principais

- [QUICK_START.md](./QUICK_START.md)
- [DEVELOPMENT.md](./DEVELOPMENT.md)
- [TESTES.md](./TESTES.md)
- [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- [FAQ.md](./FAQ.md)
- [MONITORING_GUIDE.md](./MONITORING_GUIDE.md)

## Guias especializados desta pasta

- Debug e ambiente:
  - [DEBUG_BROWSER_WINDOWS.md](./DEBUG_BROWSER_WINDOWS.md)
  - [DEBUG_NODE_INSPECTOR.md](./DEBUG_NODE_INSPECTOR.md)
  - [FIX_WINDOWS_ACCESS.md](./FIX_WINDOWS_ACCESS.md)
  - [WSL_INTEGRATION_GUIDE.md](./WSL_INTEGRATION_GUIDE.md)
- Integrações e colaboração:
  - [INTEGRACAO_OLLAMA_OPENCODE.md](./INTEGRACAO_OLLAMA_OPENCODE.md)
  - [CONTRIBUTING.md](./CONTRIBUTING.md)
- Compatibilidade legada de nomenclatura:
  - [TESTING.md](./TESTING.md) (ponte temporária para [TESTES.md](./TESTES.md))

## Auditoria qualitativa desta categoria

- A avaliação canônica desta pasta está em
  [../RELATORIOS/AUDITORIA_QUALITATIVA_CATEGORIAS_VIVAS.md](../RELATORIOS/AUDITORIA_QUALITATIVA_CATEGORIAS_VIVAS.md).
- A primeira etapa da consolidação já foi aplicada: `TESTING.md` foi rebaixado para compatibilidade
  e `TESTES.md` permanece como baseline.
- O lote principal de rewrite rigoroso já foi aplicado em:
  - [CONTRIBUTING.md](./CONTRIBUTING.md)
  - [QUICK_START.md](./QUICK_START.md)
  - [DEVELOPMENT.md](./DEVELOPMENT.md)
  - [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
  - [FAQ.md](./FAQ.md)
  - [MONITORING_GUIDE.md](./MONITORING_GUIDE.md)
- A próxima fase recomendada é revisar os guias especializados remanescentes.

## Regras de manutenção

- Se o documento ensina “como usar”, “como rodar”, “como depurar” ou “como resolver”, ele tende a
  pertencer aqui.
- Se o conteúdo explicar o porquê estrutural do sistema, ele deve ir para `ARQUITETURA/`.
- Se o conteúdo for um contrato técnico estável, ele deve ir para `REFERENCIA/`.
- Se houver duplicidade entre `TESTES.md` e `TESTING.md`, a forma canônica em pt-BR prevalece e o
  wrapper de compatibilidade não deve voltar a crescer.

## Links relacionados

- Hub principal: [../README.md](../README.md)
- Arquitetura oficial: [../ARQUITETURA/README.md](../ARQUITETURA/README.md)
- Referência técnica: [../REFERENCIA/README.md](../REFERENCIA/README.md)
