**Status**: Canônico de apoio.  
**Escopo**: aprofundamento do barramento NERV e de seus contratos de emissão/recepção.  
**Quando consultar**: ao alterar envelopes, buffers, emissão, recepção, transporte híbrido ou integrações baseadas em `ActionCode`.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# NERV

**Propósito**: documentar `src/nerv/` como barramento principal de eventos e comandos do runtime.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção, auditoria e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

O NERV é a malha de comunicação da arquitetura. Ele existe para:

- padronizar envelopes;
- transportar eventos e comandos;
- desacoplar domínios do runtime;
- oferecer observabilidade técnica do fluxo de mensagens.

Ele não decide regras de negócio nem substitui kernel, orchestrator ou server. O NERV é a camada de
mensageria e coordenação técnica.

## Responsabilidades principais

- construir a interface pública de emissão e recepção;
- manter buffers inbound/outbound;
- fornecer correlação entre mensagens;
- integrar transporte local e híbrido;
- consolidar health e telemetria do barramento;
- oferecer filtros práticos por tipo, evento e ator.

## Estrutura interna de `src/nerv/`

### `nerv.js`

É a fábrica principal do subsistema.

Responsabilidades:

- resolver o modo (`LOCAL` ou `HYBRID`);
- montar socket adapter quando necessário;
- criar telemetria, correlação, buffers, emissão, recepção e health;
- expor a API pública congelada do barramento;
- coordenar shutdown gracioso do transporte.

### `buffers/`

É a camada de filas técnicas do barramento.

Responsabilidades:

- armazenar inbound e outbound;
- aplicar limites e pressão;
- permitir inspeção explícita pelo runtime.

O NERV não auto-draina esses buffers por conta própria; essa drenagem é feita pelos subsistemas que
operam o runtime, em especial kernel e loops correlatos.

### `emission/`

É a camada de emissão de envelopes.

Responsabilidades:

- construir e enfileirar mensagens de saída;
- oferecer helpers como `emitCommand`, `emitEvent` e `emitAck`.

### `reception/`

É a camada de ingestão de envelopes.

Responsabilidades:

- receber frames/envelopes;
- normalizar e entregar aos handlers registrados;
- sustentar `receive()` e as inscrições de consumo.

### `transport/`

É a camada física de transporte do barramento.

Peças relevantes:

- `transport.js`
- `hybrid_transport.js`

Responsabilidades:

- operar o caminho local;
- combinar caminho local + Socket.io no modo híbrido;
- iniciar/parar transporte;
- expor status técnico de conectividade.

Aprofundamento específico: [NERV_TRANSPORT.md](./NERV_TRANSPORT.md).

### `correlation/`

Responsável por correlação e causalidade entre mensagens.

### `health/`

Responsável por snapshots e limiares observacionais do barramento.

### `telemetry/`

Responsável pelos sinais técnicos do próprio NERV.

### `adapters/`

Contém adaptadores e helpers que facilitam o uso do barramento a partir de outros subsistemas.

## API pública do NERV

O `createNERV(config)` retorna uma API que expõe, de forma estável:

- `emit(envelope)` e `send(envelope)`;
- `emitCommand`, `emitEvent`, `emitAck`;
- `receive(frame)`;
- `onReceive(handler)`;
- `onEvent(handler)` ou `onEvent(actionCode, handler)`;
- `onCommand(...)`;
- `onActor(actor, handler)`;
- `buffers`;
- `transport`;
- `health`;
- `telemetry`;
- `getStatus()`;
- `shutdown()`.

Essa API é a superfície canônica do barramento. Subsistemas de runtime devem preferir essa
superfície em vez de acoplamento informal a detalhes internos.

## Modos de operação

### `LOCAL`

- o barramento opera localmente em processo;
- o caminho de emissão/recepção não depende de Socket.io remoto.

### `HYBRID`

- o barramento combina caminho local com um adapter Socket.io;
- eventos também podem ser serializados e enviados pelo transporte híbrido;
- esse modo é importante quando há necessidade de bridge para outros processos ou superfícies.

## Fluxos principais

### Fluxo de emissão

1. Um subsistema emite comando ou evento.
2. O envelope é normalizado.
3. A correlação é registrada/associada.
4. O envelope entra na trilha de emissão.
5. O transporte local ou híbrido o encaminha.

### Fluxo de recepção

1. Um frame ou envelope chega ao barramento.
2. `receive()` delega à camada de recepção.
3. O envelope é validado e normalizado.
4. Handlers registrados por `onReceive`, `onEvent` ou `onActor` são acionados.

### Fluxo de observabilidade

1. Buffers, transporte ou emissão mudam de estado.
2. Telemetria e health registram o evento técnico.
3. O runtime pode ler snapshot via `health` e `getStatus()`.

## Relação com outros subsistemas

### NERV x Kernel

- o kernel drena buffers e opera a cadência principal de mensagens;
- o kernel depende do NERV para receber e emitir comandos de execução.

### NERV x Agent

- vários workers (`task_control_watcher`, `attempt_watchdog`, etc.) usam o NERV como canal de
  comando e reação.

### NERV x Driver

- `DriverNERVAdapter` é um dos principais consumidores e produtores de envelopes no runtime.

### NERV x Server

- `ServerNERVAdapter` traduz entre dashboard/socket e envelopes NERV.

## Restrições e guardrails

- O NERV não deve concentrar regra de negócio.
- O NERV não deve decidir semântica de task/missão por conta própria.
- Mudanças de envelope, correlação ou `ActionCode` impactam diretamente kernel, driver e server e
  precisam ser tratadas como mudanças estruturais.

## Dívida e observações

- O NERV depende de disciplina de consumo: listeners sem cleanup podem degradar o runtime.
- O modo híbrido adiciona complexidade de transporte e precisa ser tratado como infraestrutura de
  borda, não como default implícito para qualquer fluxo.

## Referências no código

- `src/nerv/nerv.js`
- `src/nerv/buffers/`
- `src/nerv/emission/`
- `src/nerv/reception/`
- `src/nerv/transport/`
- `src/nerv/correlation/`
- `src/nerv/health/`
- `src/nerv/telemetry/`
- `src/nerv/adapters/`
- `src/shared/nerv/constants.js`
- `src/shared/nerv/envelope.js`
