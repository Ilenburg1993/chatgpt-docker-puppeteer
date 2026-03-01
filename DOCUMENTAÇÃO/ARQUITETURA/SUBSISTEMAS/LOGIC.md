**Status**: Canônico de apoio.  
**Escopo**: aprofundamento da trilha `src/logic/`.  
**Quando consultar**: ao alterar heurísticas adaptativas, validação de resultados em arquivo ou regras semânticas não pertencentes a um único subsistema.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# LOGIC

**Propósito**: documentar `src/logic/` como camada de lógica transversal e heurística do runtime.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

`src/logic/` abriga regras de cálculo, auditoria e decisão que não pertencem integralmente a
`kernel`, `driver`, `server` ou `orchestrator`, mas que ainda são parte do comportamento do
sistema.

## Componentes principais

### `adaptive.js`

É o motor de adaptação temporal e heurística do runtime.

Responsabilidades observáveis:

- manter perfis por target;
- aprender médias, variância e estabilidade;
- calcular timeouts adaptativos;
- persistir `adaptive_state.json` em disco;
- aplicar debounce e fila de persistência;
- acionar circuit breaker para targets degradados;
- fazer decay e garbage collection de perfis antigos.

### `validator.js`

É um ponto público simplificado que reexporta a validação central de resultado.

### `validation/validation_core.js`

É a coordenação principal da validação em disco.

Responsabilidades:

- determinar idioma e contexto semântico;
- obter termos de erro via i18n;
- acionar a varredura em passagem única;
- transformar falha técnica, cancelamento e rejeição de qualidade em um contrato consistente.

### `validation/scan_engine.js`

É o motor de varredura streaming.

Responsabilidades:

- validar integridade física do arquivo;
- compilar lista de termos proibidos;
- ler o arquivo linha a linha;
- falhar cedo em caso de recusa ou conteúdo proibido;
- validar JSON, markdown/código e regex quando necessário;
- garantir fechamento de handles mesmo em erro.

## Fluxos principais

### Timeout adaptativo

1. O runtime coleta métricas por target/fase.
2. `adaptive.js` atualiza estatísticas.
3. O motor calcula timeout recomendado e risco de circuit breaker.
4. Subsistemas consumidores ajustam sua política operacional.

### Validação de resultado

1. Um resultado é persistido em arquivo.
2. `validator.js` delega para `validation_core.js`.
3. `scan_engine.js` faz a auditoria física, semântica e estrutural.
4. O sistema decide se o output é aceitável ou precisa falhar/repetir.

## Relação com outros subsistemas

### Logic x Driver

- timeouts adaptativos afetam diretamente o comportamento do pipeline de execução;
- a validação de resultado também classifica qualidade do material produzido pelo driver.

### Logic x Orchestrator

- a trilha de validação complementa a `ValidationService` do orchestrator;
- uma foca a validação de output em arquivo/scan, a outra a decisão de qualidade no fluxo de
  orquestração.

### Logic x State Runtime

- `adaptive.js` persiste estado local em disco e, portanto, conversa com a ideia de state runtime.

## Restrições e guardrails

- Não duplicar em `src/logic/` regras que pertencem claramente a um único subsistema.
- Regras adaptativas precisam ser observáveis e persistíveis.
- O motor de validação deve continuar streaming e defensivo em memória.

## Referências no código

- `src/logic/adaptive.js`
- `src/logic/validator.js`
- `src/logic/validation/validation_core.js`
- `src/logic/validation/scan_engine.js`
