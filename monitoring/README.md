# monitoring/

**Propósito**: Configuração de monitoramento e observabilidade do sistema — configuração do
Prometheus para coleta de métricas de runtime.  
**Status**: Canônico de apoio.  
**Público**: Operadores e desenvolvedores que configuram monitoramento de produção.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

| Arquivo          | Descrição                                            |
| ---------------- | ---------------------------------------------------- |
| `prometheus.yml` | Configuração do Prometheus para scraping de métricas |

## O que não deve ficar aqui

- Dados de métricas coletadas (ficam em storage externo do Prometheus)
- Logs de runtime (ficam em `logs/`)

## Regras de manutenção

- Atualize `prometheus.yml` ao adicionar novos endpoints de métricas
- Documente novos jobs de scraping adicionados

## Links relacionados

- Logs: [`logs/`](../logs/)
- Telemetria: [`src/nerv/telemetry/`](../src/nerv/telemetry/)
