# src/driver/targets

**Propósito**: Implementações concretas de drivers para alvos LLM específicos (ex.: ChatGPT).  
**Status**: Canônico.  
**Público**: Mantenedores que adicionam ou ajustam suporte a novos alvos LLM.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `ChatGPTDriver.js`: implementação completa do driver para o ChatGPT.

## O que não deve ficar aqui

- Classes base e abstratas → `src/driver/core/`
- Módulos funcionais compartilhados → `src/driver/modules/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `ChatGPTDriver.js` | Driver concreto para automação do ChatGPT |

## Regras de manutenção

- Novos alvos devem estender `TargetDriver` de `src/driver/core/`.
- Registre novos drivers na `factory.js` da pasta pai.

## Links relacionados

- Módulo pai: `src/driver/`
- Classe base: `src/driver/core/TargetDriver.js`
- Factory: `src/driver/factory.js`
