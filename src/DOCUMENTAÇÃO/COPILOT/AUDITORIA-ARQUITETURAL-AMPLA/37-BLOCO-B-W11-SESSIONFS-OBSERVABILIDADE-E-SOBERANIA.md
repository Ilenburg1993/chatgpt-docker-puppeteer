# 37 — Bloco B / W11: SessionFs com Observabilidade e Soberania Estrutural

**Status**: checkpoint complementar do Bloco B **Última atualização**: 2026-04-27 **Escopo desta
etapa**: endurecer a capability `sessionFs` após o wiring inicial, adicionando observabilidade L1
por operação e congelando a soberania estrutural do owner recém-promovido.

---

## 1. Objetivo desta subonda

Após o checkpoint anterior (`36`), `sessionFs` já havia deixado de ser apenas uma capability "tipada
e pendente" para ganhar wiring real no runtime local.

Restava, porém, um problema típico de capabilities recém-promovidas:

1. elas existem no código, mas ainda sem **telemetria própria**;
2. elas existem no runtime, mas ainda sem **gate de soberania**;
3. seu owner técnico aparece, mas ainda sem defesa explícita contra deep-imports oportunistas.

Esta subonda fecha exatamente esse delta.

---

## 2. Transformações realizadas

## 2.1 Observabilidade L1 por operação de SessionFs

O módulo `sdk/session/session-fs.js` passou a emitir métricas para operações do provider local,
seguindo o mesmo modelo já adotado em outros wrappers L1:

- `session.fs.readFile`
- `session.fs.writeFile`
- `session.fs.appendFile`
- `session.fs.exists`
- `session.fs.stat`
- `session.fs.mkdir`
- `session.fs.readdir`
- `session.fs.readdirWithTypes`
- `session.fs.rm`
- `session.fs.rename`
- `session.fs.handler.create`

Cada operação passa a emitir:

- `started`
- `succeeded`
- `failed`

com:

- `sessionId` quando disponível;
- `durationMs` nas fases terminales;
- `errorKind` nas falhas;
- atributos mínimos como `pathDepth`, `provider`, `recursive`, `force`, `contentLength` ou
  profundidade de source/destination, conforme a operação.

### Efeito arquitetural

`sessionFs` deixa de ser apenas um wiring de capability e passa a integrar a malha de
observabilidade do L1, aproximando-se do padrão já consolidado por:

- `session.ui.*`
- `session.sendAndWait`
- `rpc.compaction.compact`
- `rpc.model.switchTo`
- mutações principais de `rpc/session.js`

---

## 2.2 Soberania estrutural do owner de SessionFs

O gate executável `scripts/check-copilot-official-seams.mjs` passou a vigiar explicitamente uma nova
regra:

- `non-sdk-must-not-deep-import-session-fs`

### Regra materializada

Nenhum módulo fora de `sdk/` pode deep-importar diretamente o owner interno:

- `sdk/session/session-fs.js`

Isso força consumers externos a passarem por:

- barrel público `#copilot/sdk`, ou
- façades/ports autorizadas.

### Efeito arquitetural

A capability recém-promovida ganha o mesmo tipo de blindagem estrutural que já vinha sendo aplicado
em outras fronteiras soberanas do sistema.

---

## 2.3 Contract test do Bloco B

Foi criado um contract test dedicado:

- `tests/unit/copilot/contracts/test_sdk_boundary_block_b.spec.js`

Ele verifica, no mínimo:

1. inexistência de deep-import do owner interno de `sessionFs` fora de `sdk/`;
2. exposição da surface pública canônica de SessionFs no barrel `#copilot/sdk`.

### Efeito arquitetural

O Bloco B passa a ter não apenas uma capability promovida, mas também uma baseline de soberania
executável para ela.

---

## 3. Ajuste na leitura do inventário W9

Com esta subonda, o documento `31-INVENTARIO-FINAL-DE-CAPABILITIES-SDK-PENDENTES.md` deixa de tratar
`sessionFs` e `createSessionFsHandler` como "lacuna real" e passa a classificá-los como:

- **parcialmente promovidos**

porque agora já existe:

- owner de boot;
- owner L1;
- config client-level;
- handler session-level;
- wiring no runtime vivo;
- métricas por operação;
- gate de soberania.

O gap remanescente deixa de ser "ausência" e passa a ser principalmente:

- endurecimento final;
- desenho de possíveis adapters além do provider local;
- clarificação da relação com persistência de mais longo prazo.

---

## 4. Artefatos executáveis desta subonda

### Código

- `src/copilot/sdk/session/session-fs.js`
- `scripts/check-copilot-official-seams.mjs`

### Testes

- `tests/unit/copilot/sdk/test_sdk_session_fs.spec.js`
- `tests/unit/copilot/contracts/test_sdk_boundary_block_b.spec.js`

### Documentação

- `31-INVENTARIO-FINAL-DE-CAPABILITIES-SDK-PENDENTES.md`
- `37-BLOCO-B-W11-SESSIONFS-OBSERVABILIDADE-E-SOBERANIA.md`
- `DOCUMENTAÇÃO/ARQUITETURA/SDK-WRAPPER-IDEAL-ARCHITECTURE.md`

---

## 5. Validação desta etapa

Validação escopada conforme a política do documento `35`.

### Escopo de qualidade

- formatter apenas nos arquivos tocados;
- lint apenas nos arquivos JS/test tocados;
- typecheck estrito apenas em `src/copilot`;
- testes focados apenas na capability SessionFs, contracts correlatos e docs impactados.

### Lote mínimo esperado

- `tests/unit/copilot/sdk/test_sdk_session_fs.spec.js`
- `tests/unit/copilot/contracts/test_sdk_boundary_block_b.spec.js`
- `tests/unit/copilot/contracts/test_owner_sovereignty_block_a.spec.js`

---

## 6. Conclusão desta subonda

A promotion de `sessionFs` saiu da fase "capability ligada no runtime" e entrou na fase "capability
defensável arquiteturalmente".

Esse passo é importante porque evita um padrão perigoso muito comum em revoluções arquiteturais:

> promover uma capability nova, mas deixá-la sem telemetria, sem gate e sem owner protegido.

Com esta etapa, `sessionFs` passa a ocupar um lugar muito mais sólido dentro do Bloco B e prepara o
terreno para as próximas decisões do boundary SDK.
