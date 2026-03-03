# contracts/domains

**Propósito**: Contratos arquiteturais por domínio semântico — invariantes e regras específicas de
cada área do sistema.  
**Status**: Canônico.  
**Público**: Mantenedores e pipeline de auditoria.  
**Última atualização**: 2 de março de 2026.

## Entradas principais

| Arquivo              | Domínio                                           |
| -------------------- | ------------------------------------------------- |
| `api_dashboard.json` | Contratos da API e dashboard                      |
| `architecture.json`  | Contratos de arquitetura geral                    |
| `config_env.json`    | Contratos de configuração e variáveis de ambiente |
| `logic.json`         | Contratos de lógica de negócio                    |
| `network.json`       | Contratos de rede e comunicação                   |
| `quality.json`       | Contratos de qualidade de código                  |
| `runtime.json`       | Contratos de comportamento de runtime             |
| `schemas.json`       | Contratos de schemas de dados                     |
| `security.json`      | Contratos de segurança                            |

## Regras de manutenção

- Cada arquivo deve ter estrutura compatível com `scripts/audit/contracts/load_registry.mjs`.
- Documentar `enforce_level` para cada contrato (warn, error, blocking).

## Links relacionados

- Contratos pai: `contracts/README.md`
- Avaliadores: `scripts/audit/contracts/`
