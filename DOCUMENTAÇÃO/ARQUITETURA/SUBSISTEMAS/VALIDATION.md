**Status**: Canônico de apoio.  
**Escopo**: aprofundamento da trilha `src/validation/`.  
**Quando consultar**: ao alterar validação semântica via LLM, critérios de aceite qualitativo ou a
integração entre validação opcional e fluxo principal.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# VALIDATION

**Propósito**: documentar `src/validation/` como trilha dedicada a validação semântica
especializada.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

`src/validation/` hoje é uma trilha pequena, mas especializada: ela concentra a validação de
qualidade com LLM como juiz, separada da validação streaming/física em `src/logic/validation/` e da
validação composta do orchestrator.

## Componente principal

### `llm_judge.js`

É a implementação dedicada de "LLM-as-judge".

Responsabilidades observáveis:

- avaliar uma resposta em três dimensões: completude, relevância e qualidade;
- compor uma recomendação final (`ACCEPT`, `MANUAL_REVIEW`, `RETRY`);
- usar um driver configurado para fazer chamadas adicionais ao modelo;
- operar com timeout e thresholds configuráveis.

O módulo é opcional: se estiver desabilitado ou sem driver, ele não deve quebrar o fluxo principal.

## Diferença para outras camadas de validação

### `src/validation/` vs `src/logic/validation/`

- `src/logic/validation/` valida integridade física, formato e conteúdo proibido em arquivos.
- `src/validation/` avalia qualidade semântica da resposta via modelo.

### `src/validation/` vs `src/orchestrator/validation/validation_service.js`

- `ValidationService` é a camada de orquestração que escolhe e encadeia validadores.
- `llm_judge.js` é uma implementação concreta e dedicada do validador semântico via LLM.

## Fluxo principal

1. Um caller fornece prompt original e resposta.
2. `LLMJudge` monta prompts de avaliação.
3. Ele avalia completude, relevância e qualidade.
4. O módulo calcula score agregado.
5. A recomendação final é devolvida sem substituir a decisão de negócio do caller.

## Restrições e guardrails

- Essa trilha não deve se tornar dependência rígida do runtime inteiro.
- A ausência de driver não pode derrubar a execução principal.
- O juiz semântico complementa, mas não substitui, validação estrutural e de formato.

## Referências no código

- `src/validation/llm_judge.js`
- `src/orchestrator/validation/validation_service.js`
- `src/logic/validation/validation_core.js`
