# src/dashboard-ui/src/components/charts

**Propósito**: Componentes de gráficos e visualizações de dados do dashboard.  
**Status**: Canônico.  
**Público**: Desenvolvedores frontend.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `BarChart.vue`: gráfico de barras para métricas.
- `GaugeChart.vue`: gráfico de gauge (medidor circular).
- `LineChart.vue`: gráfico de linha para séries temporais.
- `index.js`: exportação centralizada dos componentes de chart.

## Entradas principais

| Arquivo          | Descrição                              |
| ---------------- | -------------------------------------- |
| `BarChart.vue`   | Gráfico de barras                      |
| `GaugeChart.vue` | Gráfico de medidor circular            |
| `LineChart.vue`  | Gráfico de linha para séries temporais |
| `index.js`       | Exportação centralizada                |

## Regras de manutenção

- Dados de gráficos devem vir de stores; não faça fetch direto em componentes de chart.

## Links relacionados

- Módulo pai: `src/dashboard-ui/src/components/`
- Stores: `src/dashboard-ui/src/stores/`
