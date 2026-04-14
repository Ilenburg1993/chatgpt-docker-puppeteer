# copilot/types/

Módulo **L0** de tipos compartilhados cross-module.

## Propósito

Centraliza typedefs, schemas de eventos e re-exports de tokens DI que são consumidos por múltiplos
módulos do sistema. Qualquer camada pode importar daqui sem violar a hierarquia.

## Estrutura

| Arquivo     | Conteúdo                                         |
| ----------- | ------------------------------------------------ |
| `index.js`  | Barrel — re-exports de tokens, container, events |
| `events.js` | Catálogo de nomes de eventos cross-module        |

## Uso

```js
// Via barrel
import { EVENT_NAMES, container, AUDIT_BUS } from '#copilot/types';

// Via arquivo direto
import { EVENT_NAMES } from '#copilot/types/events';
```

## Notas

- Tipos SDK permanecem em `sdk/types.js` (SSOT para tipos do `@github/copilot-sdk`).
- Tipos de hooks permanecem em `hooks/types.js`.
- Este módulo NÃO duplica tipos — apenas re-exporta ou define tipos novos cross-module.
