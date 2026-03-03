# src/driver/core

**Propósito**: Classes base e abstratas da hierarquia de drivers — `BaseDriver` e `TargetDriver`.  
**Status**: Canônico.  
**Público**: Mantenedores que implementam novos drivers de alvo.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `BaseDriver.js`: classe base com comportamentos comuns a todos os drivers.
- `TargetDriver.js`: extensão abstrata para drivers de alvos específicos (ChatGPT, etc.).

## O que não deve ficar aqui

- Implementações concretas de alvos → `src/driver/targets/`
- Factory de drivers → `src/driver/factory.js`

## Entradas principais

| Arquivo           | Descrição                                             |
| ----------------- | ----------------------------------------------------- |
| `BaseDriver.js`   | Classe base com ciclo de vida e comportamentos comuns |
| `TargetDriver.js` | Abstração para drivers de alvos LLM específicos       |

## Regras de manutenção

- Novos drivers de alvo devem estender `TargetDriver`, não `BaseDriver` diretamente.
- Métodos abstratos devem lançar `Error('not implemented')`.

## Links relacionados

- Módulo pai: `src/driver/`
- Implementações: `src/driver/targets/`
