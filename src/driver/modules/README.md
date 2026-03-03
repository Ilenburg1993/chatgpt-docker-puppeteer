# src/driver/modules

**Propósito**: Módulos funcionais compartilhados entre drivers — biomecânica de input, navegação de
frames, submissão e recuperação de erros.  
**Status**: Canônico.  
**Público**: Mantenedores de drivers de alvo.  
**Última atualização**: 2 de março de 2026.

## O que esta pasta contém

- `biomechanics_engine.js`: simulação de comportamento humano no browser.
- `frame_navigator.js`: navegação entre frames e iframes.
- `handle_manager.js`: gerenciamento de handles de elementos de página.
- `input_resolver.js`: resolução e envio de inputs ao browser.
- `recovery_system.js`: recuperação de erros e estados inválidos.
- `submission_controller.js`: controle do fluxo de submissão de prompts.
- `triage.js`: triagem de estado da página para decisão de ação.

## O que não deve ficar aqui

- Implementações específicas de alvo → `src/driver/targets/`
- Extratores de conteúdo → `src/driver/extractors/`

## Entradas principais

| Arquivo                    | Descrição                                        |
| -------------------------- | ------------------------------------------------ |
| `biomechanics_engine.js`   | Simula comportamento humano (delays, movimentos) |
| `frame_navigator.js`       | Navega entre frames da página                    |
| `submission_controller.js` | Controla submissão de prompts ao LLM             |
| `recovery_system.js`       | Trata erros e recupera estados inválidos         |
| `triage.js`                | Classifica o estado atual da página              |

## Regras de manutenção

- Módulos devem ser genéricos e reutilizáveis entre diferentes drivers de alvo.
- Não importe drivers de alvo concretos aqui (evite dependência circular).

## Links relacionados

- Módulo pai: `src/driver/`
- Compartilhados: `src/shared/biomechanics/`
