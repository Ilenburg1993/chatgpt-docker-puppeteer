# src/driver

**Propósito**: Camada de automação de browser — conecta o runtime ao Chrome externo via DevTools
Protocol e executa ações em alvos (ChatGPT, etc.).  
**Status**: Canônico.  
**Público**: Mantenedores da camada de automação e integradores de novos alvos LLM.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- Gerenciamento do ciclo de vida do driver (`DriverLifecycleManager.js`).
- Factory de drivers por alvo (`factory.js`).
- Classes base e abstratas do driver (`core/`).
- Extratores de dados estruturados da página (`extractors/`).
- Guards de prontidão do driver (`guards/`).
- Módulos funcionais: biomecânica, navegação, submissão, triagem (`modules/`).
- Adaptador NERV do driver (`nerv_adapter/`).
- Implementações de alvos específicos (`targets/`).
- Rastreadores de sessão de página (`trackers/`).

## O que não deve ficar aqui

- Gerenciamento do pool de browsers → `src/infra/browser_pool/`
- Lógica de orquestração de missões → `src/orchestrator/`
- Chamadas diretas a `puppeteer.launch()` (proibido neste módulo)

## Entradas principais

| Arquivo/Pasta               | Descrição                                        |
| --------------------------- | ------------------------------------------------ |
| `factory.js`                | Factory pattern para criação de drivers por alvo |
| `DriverLifecycleManager.js` | Gerencia o ciclo de vida de instâncias de driver |
| `core/`                     | Classes base `BaseDriver` e `TargetDriver`       |
| `targets/ChatGPTDriver.js`  | Driver específico para ChatGPT                   |
| `modules/`                  | Módulos funcionais compartilhados entre drivers  |
| `nerv_adapter/`             | Bridge entre o driver e o barramento NERV        |
| `guards/`                   | Verificação de prontidão do driver               |
| `extractors/`               | Extratores de conteúdo estruturado da página     |
| `trackers/`                 | Rastreamento de sessão de página                 |

## Regras de manutenção

- Nunca use `puppeteer.launch()`; conecte ao Chrome externo via DevTools.
- Novos alvos devem estender `TargetDriver` e registrar na `factory.js`.
- Toda ação de browser deve emitir eventos via `nerv_adapter/`.

## Links relacionados

- Pool de browsers: `src/infra/browser_pool/`
- Adaptador NERV: `src/driver/nerv_adapter/`
- Tipos: `src/types/driver/`
- Compartilhados: `src/shared/`
