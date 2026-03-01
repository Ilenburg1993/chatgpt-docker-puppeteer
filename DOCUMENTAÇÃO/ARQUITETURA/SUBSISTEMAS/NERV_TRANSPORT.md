**Status**: Canônico de apoio.  
**Escopo**: aprofundamento da subtrilha `src/nerv/transport/`.  
**Quando consultar**: ao alterar framing, conexão física, reconexão, transporte híbrido ou adapters de envio/recepção do barramento.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# NERV TRANSPORT

**Propósito**: documentar `src/nerv/transport/` como o plano físico do barramento NERV.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

`src/nerv/transport/` cuida de como bytes ou envelopes atravessam o meio físico. Essa trilha:

- empacota frames;
- conecta adapters concretos;
- faz start/stop do link;
- aplica retry técnico;
- oferece o modo híbrido local + remoto.

Ela não interpreta a semântica do envelope.

## Componentes principais

### `transport.js`

É a fábrica de composição do transporte físico clássico.

Responsabilidades:

- construir o unpacker de framing;
- compor `connection.js`;
- plugar `reconnect.js` quando política é fornecida;
- expor `start()`, `stop()`, `send()` e `onReceive()`.

É o ponto de junção entre framing, conexão e reconexão.

### `connection.js`

É a conexão física neutra.

Responsabilidades:

- encapsular um adapter concreto (`start`, `stop`, `send`, `onReceive`, `onError`);
- registrar handlers de recepção;
- emitir telemetria técnica de send/receive/start/stop;
- manter a noção de "started".

Guardrail central: esse módulo não interpreta frames.

### `framing.js`

É a delimitação física dos frames.

Responsabilidades:

- prefixar payload com header de 4 bytes big-endian;
- reconstruir frames a partir de chunks parciais;
- manter buffer incremental no unpacker.

É a camada que separa "stream bruto" de "mensagem física completa".

### `reconnect.js`

É a política técnica de reconexão.

Responsabilidades:

- agendar tentativas por timer;
- respeitar `interval` e `maxAttempts`;
- emitir telemetria de tentativa, exaustão e stop;
- invocar `stop()` e `start()` sem propagar exceções.

Esse módulo trata apenas disponibilidade do link, não sucesso semântico da mensagem.

### `hybrid_transport.js`

É o modo especial local + remoto.

Responsabilidades observáveis:

- manter um bus local in-process com `EventEmitter`;
- opcionalmente enviar também via `socketAdapter`;
- sempre privilegiar o fast-path local;
- aplicar circuit breaker (`CLOSED`, `OPEN`, `HALF_OPEN`) para o canal remoto;
- registrar handlers locais com unsubscribe.

No baseline atual, essa é a peça que viabiliza a mistura de entrega local com bridge remota sem
abrir mão do caminho em processo.

## Fluxos principais

### Fluxo físico clássico

1. Um frame opaco é entregue a `send()`.
2. `framing.pack()` adiciona o prefixo de tamanho.
3. `connection.js` envia os bytes pelo adapter.
4. No inbound, chunks recebidos passam pelo unpacker.
5. Frames completos são entregues ao handler.

### Fluxo híbrido

1. O envelope é sempre emitido no bus local.
2. Se o modo for híbrido e o circuito permitir, o payload também vai ao adapter remoto.
3. Falha remota atualiza o circuit breaker.
4. O runtime continua recebendo o caminho local mesmo com degradação remota.

## Relação com outros subsistemas

### NERV Transport x NERV Core

- `src/nerv/nerv.js` usa essa trilha como base de conectividade;
- emissão, recepção, health e telemetria dependem dela para o plano físico.

### NERV Transport x Infra Transport

- adapters concretos, como Socket.io, vêm da infraestrutura;
- `src/nerv/transport/` consome adapters, mas não define a política global de infra.

## Restrições e guardrails

- Não inserir parsing semântico de envelope nesta trilha.
- Não acoplar `ActionCode`, task ou missão ao transporte físico.
- Circuit breaker em `hybrid_transport.js` deve continuar protegendo apenas o caminho remoto.
- O caminho local não deve depender do sucesso do canal remoto.

## Sinais operacionais a investigar

- backlog de `onReceive` sem consumo;
- parse quebrado por framing inconsistente;
- reconnect em loop sem estabilização;
- circuit breaker permanentemente aberto no modo híbrido;
- adapters remotos lançando exceção no `send()`.

## Referências no código

- `src/nerv/transport/transport.js`
- `src/nerv/transport/connection.js`
- `src/nerv/transport/framing.js`
- `src/nerv/transport/reconnect.js`
- `src/nerv/transport/hybrid_transport.js`
