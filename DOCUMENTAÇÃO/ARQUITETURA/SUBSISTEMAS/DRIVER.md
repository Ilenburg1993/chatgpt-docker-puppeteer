**Status**: Canônico de apoio.  
**Escopo**: aprofundamento do subsistema de execução browser e seus contratos.  
**Quando consultar**: ao alterar factory, drivers, adapter NERV, pooling de drivers ou módulos de
execução em página.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# DRIVER

**Propósito**: documentar `src/driver/` como subsistema de atuação browser do runtime.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção, auditoria e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

O subsistema de driver é o atuador do sistema. É ele que transforma uma task em interação real com o
alvo browser.

Ele é responsável por:

- encapsular o contrato de execução por target;
- usar páginas e contexto fornecidos pela infraestrutura;
- emitir sinais de telemetria e eventos de execução;
- traduzir comandos recebidos do NERV em ações concretas no browser.

Ele não é o dono do browser nem o ponto de decisão estratégica.

## Estrutura interna de `src/driver/`

### `factory.js`

É a porta de entrada principal para descoberta e provisionamento de drivers.

Responsabilidades:

- fazer auto-discovery de drivers em `targets/`;
- carregar classes sob demanda;
- manter pool de drivers idle;
- aquecer e reciclar instâncias;
- expor telemetria de factory/pool;
- funcionar como ponto de reutilização e allocation.

Na topologia atual, a factory é mais do que “um construtor”; ela é uma camada de lifecycle e reuse.

### `DriverLifecycleManager.js`

É a camada de coordenação de lifecycle de uso do driver.

Responsabilidades:

- padronizar acquire/release;
- controlar acoplamento e desacoplamento ao contexto de execução;
- proteger transições de uso.

### `core/`

Contém os contratos base do subsistema.

Peças principais:

- `TargetDriver.js`: contrato abstrato dos drivers;
- `BaseDriver.js`: implementação base concreta com o pipeline real de execução.

#### `TargetDriver.js`

Define:

- máquina de estados do driver;
- eventos observáveis;
- API mínima que qualquer driver concreto precisa respeitar.

#### `BaseDriver.js`

Concentra a implementação concreta do fluxo de:

- preparação de contexto;
- resolução de input;
- typing;
- submissão;
- recuperação progressiva;
- emissão de vitals e sinais de triagem.

### `modules/`

É o pipeline granular da execução em página.

Peças principais:

- `biomechanics_engine.js`
- `frame_navigator.js`
- `handle_manager.js`
- `input_resolver.js`
- `recovery_system.js`
- `submission_controller.js`
- `triage.js`

Responsabilidade:

- decompor a execução browser em partes testáveis e especializadas.

Aprofundamento específico: [DRIVER_MODULES.md](./DRIVER_MODULES.md).

### `guards/`

Guards de readiness e pré-condições do driver.

Peça principal:

- `DriverReadinessGuard.js`

### `extractors/`

Extratores estruturados de saída e sinal.

### `trackers/`

Rastreio de sessão e estado de página.

Peça principal:

- `PageSessionTracker.js`

### `targets/`

Implementações concretas por alvo.

Peça principal observável:

- `ChatGPTDriver.js`

É aqui que o contrato abstrato ganha especialização por produto/target.

### `nerv_adapter/driver_nerv_adapter.js`

É a ponte entre o barramento NERV e o subsistema de driver.

Responsabilidades:

- escutar comandos `DRIVER_*`;
- alocar/gerenciar drivers ativos por task;
- controlar timeout, degraded mode, retries e circuit breaker local;
- persistir artifacts de execução;
- emitir eventos de sucesso, falha, aborto, telemetry e health.

Esse adapter é um dos pontos mais críticos do subsistema, porque transforma envelopes em execução
real com gestão de estado em processo.

## Fluxo canônico de execução do driver

1. O kernel/orchestrator envia um comando de execução via NERV.
2. `DriverNERVAdapter` recebe o envelope.
3. O adapter adquire driver/contexto compatível.
4. O driver prepara contexto e página.
5. `BaseDriver` executa o pipeline de input, typing, submit e espera.
6. O adapter persiste artifacts e emite eventos `DRIVER_TASK_*`.
7. O kernel reage ao resultado e decide continuidade.

## Relação com outros subsistemas

### Driver x Infra

- O driver depende de `browser_pool`, artifacts e storage.
- O driver não deve assumir ownership do browser fora desse contrato.

### Driver x Kernel

- O kernel decide quando e como despachar.
- O driver executa no alvo.

### Driver x Agent

- `QueueWorker` e outros workers fazem o despacho operacional, mas não executam o browser.

### Driver x NERV

- O adapter NERV é o canal principal de entrada/saída do subsistema.

## Restrições arquiteturais

- O subsistema não deve introduzir `puppeteer.launch()` como novo padrão do runtime.
- O driver deve continuar operando sobre páginas/contextos providos pela infraestrutura.
- O adapter precisa continuar respeitando correlação e timeouts para não quebrar idempotência do
  kernel.

## Sinais e problemas típicos

Problemas a investigar primeiro:

- crescimento anormal de `activeDrivers` no adapter;
- degraded mode por ausência de `browserPool`;
- falhas recorrentes de `DRIVER_EXECUTE_TASK`;
- drivers presos em estados não terminais;
- artifacts ausentes após execução.

## Dívida e observações estruturais

- `DriverLifecycleManager.js` ainda convive com a factory e adapters como peça de lifecycle; esse
  recorte exige disciplina para não duplicar responsabilidades.
- A telemetria do adapter e a telemetria da factory se complementam, mas não substituem a
  observabilidade do kernel.

## Referências no código

- `src/driver/factory.js`
- `src/driver/DriverLifecycleManager.js`
- `src/driver/core/TargetDriver.js`
- `src/driver/core/BaseDriver.js`
- `src/driver/nerv_adapter/driver_nerv_adapter.js`
- `src/driver/modules/biomechanics_engine.js`
- `src/driver/modules/input_resolver.js`
- `src/driver/modules/recovery_system.js`
- `src/driver/modules/submission_controller.js`
- `src/driver/guards/DriverReadinessGuard.js`
- `src/driver/targets/ChatGPTDriver.js`
- `src/driver/trackers/PageSessionTracker.js`
