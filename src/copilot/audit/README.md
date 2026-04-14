# audit/

**Camada**: L2 — pipeline de auditoria de tools, permissões e eventos.

Centraliza a coleta, ring buffer e processamento de eventos de auditoria para compliance e
observabilidade.

## Conteúdo

| Arquivo          | Responsabilidade                                     |
| ---------------- | ---------------------------------------------------- |
| `pipeline.js`    | Pipeline central de auditoria (handlers, formatação) |
| `ring-buffer.js` | Buffer circular para armazenar eventos recentes      |
| `types.js`       | Typedefs do módulo                                   |
| `index.js`       | Barrel de exportação                                 |

## Regras de importação

- **Pode importar**: `core/`, `config/`, `observability/`
- **NÃO pode importar**: `agent/`, `sdk/`, `terminal/`
