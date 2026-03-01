**Status**: Canônico de apoio.  
**Escopo**: aprofundamento de `src/types/` e da camada de contratos para type checking.  
**Quando consultar**: ao alterar tipos globais, augmentations, JSDoc centralizado, guards de tipo ou contratos de domínio usados por IDE e validação estática.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# TYPES

**Propósito**: documentar `src/types/` como a camada de contrato estático do repositório.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

`src/types/` não executa lógica de negócio. Ele sustenta o entendimento estático do código por:

- TypeScript em arquivos `.d.ts`;
- JSDoc centralizado em `.js`;
- augmentations por domínio;
- guards reutilizáveis de runtime para reduzir casts inseguros.

É a camada que ajuda a manter o repositório "typed" mesmo com muito JavaScript ESM.

## Estrutura principal

### Base global

- `index.d.ts`
- `global.d.ts`
- `global/ambient.d.ts`

Função:

- declarar tipos globais, ambient declarations e pontos de entrada para a malha de tipagem.

### Núcleo comum

- `core.js`
- `core.d.ts`
- `guards.js`

Função:

- centralizar typedefs amplos (NERV, tasks, missões, API, driver, telemetria);
- fornecer guards de runtime (`isObject`, `isTaskStatus`, `isActionCode`, etc.);
- reduzir uso de `any` e casts repetitivos.

### Contratos de driver

- `driver/contracts.js`
- `driver/contracts.d.ts`

Função:

- explicitar contratos e superfícies da camada de driver para consumo tipado.

### Extensões específicas por domínio

Diretórios observáveis:

- `core/`
- `infra/`
- `kernel/`
- `logic/`
- `missions/`
- `nerv/`
- `orchestrator/`
- `server/`
- `shared/`
- `validation/`

Padrão predominante:

- `augmentations.d.ts` por domínio para ampliar tipos já existentes sem duplicar a base.

### Extensões específicas do server

- `server/socket_io_extensions.d.ts`

Função:

- declarar extensões de tipagem ligadas ao ecossistema Socket.io do servidor.

## Relação com outros subsistemas

### Types x Código de runtime

- `src/types/` orienta o código de runtime, mas não o substitui;
- se o contrato estático divergir do contrato real, o documento correto continua sendo o código.

### Types x Documentação canônica

- esta trilha documenta a malha de tipagem;
- mudanças em shape estrutural precisam alinhar código, tipos e docs.

## Restrições e guardrails

- Não usar `src/types/` para esconder inconsistência do runtime.
- Augmentations devem refletir contratos reais, não desejos futuros.
- Toda nova tipagem transversal deve preferir esta trilha antes de espalhar typedefs soltos.

## Sinais de problema

- augmentations obsoletas após refatoração estrutural;
- guards aceitando payloads que o runtime rejeita;
- contratos `.d.ts` divergindo de JSDoc centralizado;
- necessidade crescente de casts locais apesar de a trilha existir.

## Referências no código

- `src/types/index.d.ts`
- `src/types/global.d.ts`
- `src/types/core.js`
- `src/types/core.d.ts`
- `src/types/guards.js`
- `src/types/driver/contracts.js`
- `src/types/driver/contracts.d.ts`
- `src/types/server/socket_io_extensions.d.ts`
- `src/types/*/augmentations.d.ts`
