# src/dashboard-ui/src/views

**Propósito**: Views de página do dashboard — cada arquivo corresponde a uma rota da aplicação.  
**Status**: Canônico.  
**Público**: Desenvolvedores frontend.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

Views organizadas por domínio:

- **Dashboard**: `Dashboard.vue`, `DashboardView.vue`
- **Tarefas**: `TasksView.vue`, `TaskDetail.vue`, `TaskQueue.vue`
- **Missões**: `Missions.vue`, `MissionDetail.vue`
- **Auditoria**: `AuditView.vue`, `AuditJobs.vue`, `AuditJobDetail.vue`, `AuditInference.vue`,
  `AuditPatchDetail.vue`
- **Artefatos**: `ArtifactView.vue`
- **Monitoramento**: `SystemHealth.vue`, `PerformanceMetrics.vue`, `EventCorrelation.vue`
- **Workflows**: `WorkflowEditor.vue`, `WorkflowView.vue`
- **Templates**: `Templates.vue`
- **Utilitário**: `NotFound.vue`

## O que não deve ficar aqui

- Componentes reutilizáveis → `src/dashboard-ui/src/components/`
- Lógica de estado → `src/dashboard-ui/src/stores/`

## Entradas principais

| Arquivo              | Descrição                   |
| -------------------- | --------------------------- |
| `Dashboard.vue`      | View principal do dashboard |
| `TasksView.vue`      | View de lista de tarefas    |
| `AuditView.vue`      | View de auditoria           |
| `SystemHealth.vue`   | View de saúde do sistema    |
| `Missions.vue`       | View de missões             |
| `WorkflowEditor.vue` | Editor de workflows         |

## Regras de manutenção

- Cada view deve corresponder a uma rota registrada em `router/index.js`.
- Views devem usar composables e stores; não acesse a API diretamente.

## Links relacionados

- Módulo pai: `src/dashboard-ui/src/`
- Router: `src/dashboard-ui/src/router/`
- Componentes: `src/dashboard-ui/src/components/`
