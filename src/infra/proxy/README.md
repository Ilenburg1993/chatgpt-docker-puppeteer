# src/infra/proxy

**Propósito**: Serviço de proxy do Chrome — redireciona conexões ao browser via proxy configurável.  
**Status**: Especializado.  
**Público**: Mantenedores de infraestrutura de browser e operadores de ambiente.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `chromeProxyService.js`: implementação do serviço de proxy do Chrome.
- `chromeProxyService.d.ts`: definições de tipos TypeScript do serviço.

## O que não deve ficar aqui

- Pool de browsers → `src/infra/browser_pool/`
- Configuração de conexão DevTools → `src/driver/`

## Entradas principais

| Arquivo | Descrição |
|---|---|
| `chromeProxyService.js` | Serviço de proxy para conexões ao Chrome |
| `chromeProxyService.d.ts` | Tipos TypeScript do serviço de proxy |

## Regras de manutenção

- Configurações de proxy devem vir de `config.json` ou variáveis de ambiente.

## Links relacionados

- Módulo pai: `src/infra/`
- Pool de browsers: `src/infra/browser_pool/`
