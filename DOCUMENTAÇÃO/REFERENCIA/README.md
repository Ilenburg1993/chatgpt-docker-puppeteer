# REFERENCIA

**Propósito**: concentrar APIs, contratos técnicos, configuração, variáveis, aliases e material de
consulta estável do projeto.  
**Status documental**: Canônico.  
**Público**: engenharia, manutenção, integração e agentes de IA.  
**Última atualização**: 1 de março de 2026.

## O que esta pasta contém

- documentação de API e superfícies expostas;
- arquivos de configuração e convenções de ambiente;
- guias de variáveis, aliases e scripts;
- glossário e checklists técnicos de referência;
- material de integração estável.

## O que não deve ficar aqui

- guias de onboarding e troubleshooting;
- arquitetura conceitual profunda;
- planos de execução futura;
- relatórios de implementação ou análise histórica.

## Entradas principais

- [API_REFERENCE.md](./API_REFERENCE.md)
- [CONFIGURATION.md](./CONFIGURATION.md)
- [ENV_VARIABLES_GUIDE.md](./ENV_VARIABLES_GUIDE.md)
- [../../.env.expert.example](../../.env.expert.example)
- [MODULE_ALIASES.md](./MODULE_ALIASES.md)
- [SCRIPTS.md](./SCRIPTS.md)
- [GLOSSARY.md](./GLOSSARY.md)

## Referências especializadas desta pasta

- Saúde e readiness:
  - [HEALTH_ENDPOINT.md](./HEALTH_ENDPOINT.md)
  - [REBUILD_READY_CHECKLIST.md](./REBUILD_READY_CHECKLIST.md)
- Ambiente e configuração:
  - [ENV_VARIABLES_GUIDE.md](./ENV_VARIABLES_GUIDE.md)
  - [../AUDITORIAS/ENV_STRUCTURE_AUDIT_2026-03-01.md](../AUDITORIAS/ENV_STRUCTURE_AUDIT_2026-03-01.md)
  - [../../.devcontainer/ENV_VARIABLE_REFERENCE.md](../../.devcontainer/ENV_VARIABLE_REFERENCE.md)
- Qualidade e toolchain:
  - [ESLINT_GUIDE.md](./ESLINT_GUIDE.md)
  - [STRICT_MIGRATION_CHECKLIST.md](./STRICT_MIGRATION_CHECKLIST.md)
  - [NERV_INTEGRATION_CHECKLIST.md](./NERV_INTEGRATION_CHECKLIST.md)
- Alias e validação:
  - [MODULE_ALIASES.md](./MODULE_ALIASES.md)
- Uso e exemplos:
  - [DRIVER_EXAMPLES.md](./DRIVER_EXAMPLES.md)

## Subárvores locais

- [INTEGRACOES/README.md](./INTEGRACOES/README.md): material de integração focado em fluxos como
  RAG, MCP e LSP.

## Compatibilidade legada de nomenclatura

- [API.md](./API.md): ponte curta para `API_REFERENCE.md`.
- [CONFIG_FILES.md](./CONFIG_FILES.md): ponte curta para `CONFIGURATION.md`.

## Auditoria qualitativa desta categoria

- A avaliação canônica desta pasta está em
  [../RELATORIOS/AUDITORIA_QUALITATIVA_CATEGORIAS_VIVAS.md](../RELATORIOS/AUDITORIA_QUALITATIVA_CATEGORIAS_VIVAS.md).
- A primeira etapa da consolidação já foi aplicada: `API.md` e `CONFIG_FILES.md` foram rebaixados
  para compatibilidade, enquanto `API_REFERENCE.md` e `CONFIGURATION.md` permanecem como baseline.
- A segunda etapa da consolidação também já foi aplicada: os relatórios de aliases foram
  reclassificados para
  [../RELATORIOS/RECLASSIFICADOS/README.md](../RELATORIOS/RECLASSIFICADOS/README.md).

## Regras de manutenção

- Se o documento responder “qual é o contrato”, “qual é a configuração” ou “qual é a referência
  estável”, ele tende a pertencer aqui.
- Relatórios com cara de análise podem permanecer aqui apenas quando funcionarem como referência
  técnica recorrente; se forem puramente históricos, devem migrar para `RELATORIOS/` ou
  `ARQUIVO_MORTO/`.
- Sempre que uma regra técnica for usada por várias áreas, a versão canônica deve viver aqui.

## Links relacionados

- Hub principal: [../README.md](../README.md)
- Integrações: [./INTEGRACOES/README.md](./INTEGRACOES/README.md)
- Arquitetura: [../ARQUITETURA/README.md](../ARQUITETURA/README.md)
- Auditorias: [../AUDITORIAS/README.md](../AUDITORIAS/README.md)
