**Status**: Canônico de apoio.  
**Escopo**: aprofundamento da subtrilha `src/driver/modules/`.  
**Quando consultar**: ao alterar o pipeline de interação em página, navegação em frames, triagem,
recuperação ou submissão.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# DRIVER MODULES

**Propósito**: documentar `src/driver/modules/` como pipeline granular de execução browser.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção, QA e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

`src/driver/modules/` existe para quebrar o driver em componentes especializados, em vez de
concentrar toda a execução em `BaseDriver`.

Essa trilha:

- isola comportamento físico de UI;
- centraliza recuperação e triagem;
- melhora telemetria e diagnósticos;
- reduz o acoplamento entre target drivers e detalhes de execução.

## Componentes principais

### `biomechanics_engine.js`

É o executor físico mais sensível da trilha.

Responsabilidades observáveis:

- preparar elementos antes da interação;
- calcular scroll e estabilidade de viewport;
- executar typing biomimético ou "zen mode" para payloads longos;
- manter keep-alive da sessão;
- rastrear métricas detalhadas e eventos locais.

É a peça que aproxima a execução do comportamento humano esperado na UI do alvo.

### `frame_navigator.js`

É o resolvedor de contexto em árvores de iframe.

Responsabilidades:

- percorrer `framePath` com limite de profundidade;
- detectar barreiras de infra e segurança;
- calcular offsets físicos e bounding boxes;
- limpar handles com retry;
- devolver o contexto correto de execução.

Sem ele, o driver degrada rapidamente em páginas com iframes aninhados.

### `handle_manager.js`

É o guardião de handles temporários.

Responsabilidades:

- registrar handles de Puppeteer;
- centralizar cleanup;
- evitar vazamento de `ElementHandle` e `JSHandle`;
- rastrear telemetria de lifecycle local.

É uma camada de higiene de memória e estabilidade.

### `input_resolver.js`

É o tradutor entre intenção lógica e alvo físico.

Responsabilidades:

- interpretar o protocolo de input;
- resolver selectors, estratégias e fallbacks;
- localizar elementos e preparar contexto utilizável para o restante do pipeline.

Ele conecta o plano semântico da task ao plano físico da página.

### `recovery_system.js`

É a malha de remediação progressiva da execução.

Responsabilidades:

- aplicar tiers escalonados de recuperação;
- invalidar cache e atrasar taticamente;
- restaurar foco;
- recarregar página com estabilização;
- em último caso, provocar encerramento duro do processo/sessão.

O sistema observado trabalha com quatro níveis de reação, com telemetria e métricas próprias.

### `submission_controller.js`

É a camada que decide como e quando a submissão do prompt é materializada.

Responsabilidades:

- escolher gesto de submit compatível com o alvo;
- validar se a submissão realmente ocorreu;
- padronizar tentativas, timeout e observação do pós-submit.

É a fronteira entre "texto preenchido" e "execução efetivamente disparada".

### `triage.js`

É o diagnóstico local de falha e estagnação.

Responsabilidades:

- classificar sintomas de stall;
- detectar padrões de erro recorrente;
- produzir categorias acionáveis para recovery e telemetria;
- auxiliar a distinguir falha técnica de falha semântica.

É o módulo que evita que todo erro seja tratado como timeout genérico.

## Padrões estruturais observáveis

- Os módulos principais são instrumentados com `EventEmitter`.
- Cada componente expõe constantes de config e eventos quando o domínio exige.
- Timeouts, thresholds e retry policies são externalizados por variáveis de ambiente.
- O pipeline privilegia isolamento: navegação, resolução, submissão, recovery e triagem ficam
  desacoplados.

## Fluxo canônico dentro do driver

1. `BaseDriver` recebe a execução.
2. `input_resolver.js` resolve o alvo.
3. `frame_navigator.js` produz o contexto correto em página/frame.
4. `biomechanics_engine.js` realiza preparação, scroll, focus e typing.
5. `submission_controller.js` dispara o submit.
6. `triage.js` observa sintomas anômalos.
7. `recovery_system.js` reage em tiers quando necessário.
8. `handle_manager.js` garante cleanup dos recursos transitórios.

## Relação com outros subsistemas

### Driver Modules x BaseDriver

- `BaseDriver` orquestra.
- `modules/` executa capacidades granulares e reutilizáveis.

### Driver Modules x Shared

- `biomechanics_engine.js` consome helpers de `src/shared/biomechanics/`, `src/shared/sadi/` e
  `src/shared/page_stability/`.
- Isso mostra que a trilha depende de primitivas compartilhadas, mas continua pertencendo ao
  subsistema de driver.

### Driver Modules x Infra

- recovery e readiness dependem do estado da página provida pelo pool;
- erros aqui frequentemente refletem problemas de sessão, foco ou estabilidade do ambiente.

## Restrições e guardrails

- Não duplicar lógica de módulos dentro de target drivers.
- Não mover para `BaseDriver` detalhes que já estão isolados em módulo reutilizável.
- Recovery não deve mascarar falha estrutural persistente do browser pool.
- Triage e recovery precisam permanecer separados: diagnosticar não é remediar.

## Sinais operacionais a investigar

- crescimento de timeouts em `FrameNavigator`;
- handles não descartados;
- explosão de tiers 2 e 3 no recovery;
- submit aparentemente concluído sem mudança real de estado;
- loops de triagem classificando tudo como stall indistinto.

## Referências no código

- `src/driver/modules/biomechanics_engine.js`
- `src/driver/modules/frame_navigator.js`
- `src/driver/modules/handle_manager.js`
- `src/driver/modules/input_resolver.js`
- `src/driver/modules/recovery_system.js`
- `src/driver/modules/submission_controller.js`
- `src/driver/modules/triage.js`
- `src/driver/core/BaseDriver.js`
