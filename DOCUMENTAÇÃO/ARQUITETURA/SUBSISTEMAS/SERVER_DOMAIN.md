**Status**: Canônico de apoio.  
**Escopo**: aprofundamento da subtrilha `src/server/domain/`.  
**Quando consultar**: ao alterar comandos de controle, mutações de task/missão, RBAC, operações
administrativas ou integrações de controle expostas pelo backend.  
**Documento-mestre relacionado**: [ARCHITECTURE.md](../ARCHITECTURE.md).

# SERVER DOMAIN

**Propósito**: documentar `src/server/domain/` como camada de domínio e comando do backend.  
**Status documental**: Canônico de apoio.  
**Público**: engenharia, manutenção e agentes de IA.  
**Última atualização**: 28 de fevereiro de 2026.

## Papel arquitetural

`src/server/domain/` recebe intenções vindas da API/control plane e as transforma em mutações
consistentes sobre o sistema. Essa trilha:

- protege precondições e versões;
- aplica RBAC;
- registra operações e eventos;
- encapsula mutações de task e missão;
- centraliza comandos administrativos de auditoria, inferência e diagnóstico.

## Componentes principais

### `task_control_service.js`

É o domínio de mutação de tasks.

Responsabilidades observáveis:

- criar tasks V5;
- validar edição e reassign;
- aplicar pause, resume, retry, cancel e purge;
- usar precondição por versão (`ifVersion`) quando necessário;
- registrar eventos de task e missão derivados da operação.

### `mission_control_service.js`

É o domínio de mutação de missões.

Responsabilidades:

- criar, executar, pausar, resumir, cancelar e editar missões;
- atualizar política e reordenar steps;
- sincronizar `mission_steps` a partir do workflow;
- propagar cancelamento em cascata para tasks quando necessário;
- registrar eventos estruturados da missão.

### `rbac_policy.js`

É o enforcement local de autorização.

Responsabilidades:

- normalizar o ator;
- verificar permissão;
- lançar `FORBIDDEN` quando a operação não é autorizada.

### `control_command_service.js`

É o barramento de comando de alto nível do backend.

Responsabilidades observáveis:

- expor um vocabulário canônico de comandos (`MISSION_*`, `TASK_*`, `AUDIT_*`, `INFERENCE_*`,
  `DIAGNOSTIC_*`);
- mapear comandos para permissões;
- validar requisitos como `ifVersion` e `entityId`;
- delegar para `task_control_service.js` e `mission_control_service.js`;
- integrar auditoria, watch rules, inference gateway e diagnóstico;
- registrar `control_operations`, diffs e eventos;
- emitir status de execução do comando.

## Fluxos principais

### Fluxo de mutação de task

1. A API/control plane pede uma operação.
2. O ator é normalizado e autorizado.
3. `task_control_service.js` valida precondições.
4. A task é mutada no SSOT.
5. Eventos e efeitos colaterais controlados são registrados.

### Fluxo de mutação de missão

1. O comando entra pelo control plane.
2. `mission_control_service.js` valida estado e versão.
3. A missão é atualizada.
4. `mission_steps` e tasks relacionadas podem ser sincronizadas ou cascatas podem ocorrer.

### Fluxo de comando administrativo

1. `control_command_service.js` recebe um comando canônico.
2. O comando é validado e autorizado.
3. A delegação ocorre para o domínio correto.
4. A operação é registrada em `control_operations`.
5. Diffs, eventos e status são publicados.

## Relação com outros subsistemas

### Server Domain x Server API

- controllers e router expõem a borda;
- `src/server/domain/` concentra a lógica de mutação e precondição.

### Server Domain x Infra DB

- a maior parte das mutações termina em repositórios do SSOT;
- essa trilha depende fortemente de `task_repo`, `mission_repo`, RBAC e eventos.

### Server Domain x Audit / Inference / Diagnostic

- o control plane unifica comandos desses domínios sob uma única camada de autorização e
  rastreabilidade.

## Restrições e guardrails

- Não colocar regra de domínio mutante diretamente em controller HTTP.
- Comandos precisam continuar versionados, auditáveis e autorizáveis.
- `control_command_service.js` não deve virar um atalho para bypassar serviços de domínio.

## Referências no código

- `src/server/domain/task_control_service.js`
- `src/server/domain/mission_control_service.js`
- `src/server/domain/rbac_policy.js`
- `src/server/domain/control_command_service.js`
