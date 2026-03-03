# src/inference_gateway

**Propósito**: Gateway centralizado para acesso a modelos de inferência LLM — gerencia políticas,
backends, supervisão de hosts Ollama e persistência de configurações.  
**Status**: Especializado.  
**Público**: Módulos que precisam invocar LLMs; mantenedores de integrações de inferência.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Gateway principal de inferência (`gateway.js`).
- Servidor HTTP do gateway (`server.js`).
- Bootstrap do módulo (`main.js`).
- Configuração de políticas de clientes (`policy_config.js`).
- Supervisor de hosts Ollama (`ollama_host_supervisor.js`).
- Persistência de configurações de inferência (`persistence.js`).
- Tags de clientes para roteamento (`client_tags.js`).

## O que não deve ficar aqui

- Chamadas diretas a LLMs fora do gateway → use `gateway.js`
- Ferramentas de integração externas → `src/integration/tools/`
- Agente de auditoria LLM → `src/audit_agent/`

## Entradas principais

| Arquivo                     | Descrição                                     |
| --------------------------- | --------------------------------------------- |
| `gateway.js`                | Roteamento e execução de chamadas a LLMs      |
| `main.js`                   | Bootstrap do gateway de inferência            |
| `server.js`                 | Servidor HTTP do gateway                      |
| `policy_config.js`          | Políticas de roteamento e seleção de backend  |
| `ollama_host_supervisor.js` | Supervisão de disponibilidade de hosts Ollama |
| `persistence.js`            | Persistência de configurações e histórico     |
| `client_tags.js`            | Tags para roteamento de clientes              |

## Regras de manutenção

- Todo acesso a LLM no sistema deve passar pelo gateway; não faça chamadas diretas.
- Novos backends de inferência devem ser registrados via `policy_config.js`.

## Links relacionados

- Integração com ferramentas: `src/integration/`
- Contexto LLM: `src/core/context/`
- Tipos: `src/types/`
