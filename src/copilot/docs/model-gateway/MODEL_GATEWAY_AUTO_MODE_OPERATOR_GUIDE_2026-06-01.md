# Model Gateway Auto Mode Operator Guide

Status: guia operacional curto para humanos e LLMs.

Roadmap ativo:
`src/copilot/docs/model-gateway/CANONICAL_MODEL_GATEWAY_RUNTIME_AUTOMATION_ROADMAP_2026-06-01.md`

## Objetivo

O modo auto do model-gateway decide a próxima ação de modelo para o terminal BYOK sem misturar metadados canônicos com
estado volátil de runtime.

Ele usa:

- catálogo normalizado;
- account overlays;
- runtime health;
- runtime selector;
- binding da sessão SDK viva;
- policy do operador.

Ele não deve chamar provider por acidente.

## Comandos Principais

```bash
npm run model-gateway:ops
npm run model-gateway:auto:status
npm run model-gateway:auto:status -- --write-sqlite
```

No terminal:

```text
/byok auto status profile:repo_agent
/byok auto record profile:repo_agent
/byok auto apply profile:repo_agent allow-live-set-model
/byok auto off
```

## Estados

- `keep_current`: sessão viva já está alinhada.
- `apply_live_model`: mesmo provider boundary; `setModel` pode ser solicitado se a policy permitir.
- `prepare_new_session`: provider/perfil mudou ou não há sessão viva; novo boot SDK é necessário.
- `wait_for_reset`: rota bloqueada por rate-limit/cooldown resetável.
- `manual_intervention`: policy ou blocker impede ação automática.

## Blocker Classes

- `quota_hard`: saldo, crédito, spending ou quota sem reset seguro.
- `rate_limit_resettable`: rate-limit/cooldown com reset ou retry-after.
- `auth_invalid`: key inválida, ausente, desabilitada ou sem permissão.
- `model_unavailable`: rota/modelo ausente, removido ou indisponível.
- `local_private_policy`: Ollama/local privado sem opt-in explícito.
- `new_session_policy`: nova sessão necessária, mas policy não autorizou.
- `route_blocked`: bloqueio genérico ainda não classificado.

## Env De Policy

```bash
COPILOT_BYOK_GATEWAY_AUTO=true
COPILOT_BYOK_GATEWAY_AUTO_POLICY=prefer_runtime_proved
COPILOT_BYOK_GATEWAY_AUTO_PROFILES=repo_agent,code,tool_agent
COPILOT_BYOK_GATEWAY_AUTO_ALLOW_LIVE_SET_MODEL=true
COPILOT_BYOK_GATEWAY_AUTO_ALLOW_NEW_SESSION=false
COPILOT_BYOK_GATEWAY_AUTO_ALLOW_PROVIDER_PROBES=false
COPILOT_BYOK_GATEWAY_AUTO_ALLOW_LOCAL_PRIVATE=false
COPILOT_BYOK_GATEWAY_AUTO_ACCOUNT_WIDE_FAILURE_KINDS=auth,credits,rate-limit
```

Defaults são conservadores:

- auto off;
- probes off;
- Ollama/local off;
- nova sessão apenas advisory salvo autorização explícita;
- `setModel` live só dentro da mesma boundary BYOK.

## Fluxo Recomendado Antes De Live Test

1. Rode `npm run model-gateway:ops`.
2. Se `ops.ok=true`, rode `/byok auto status profile:repo_agent`.
3. Se quiser trilha operacional sem aplicar efeito, rode `/byok auto record profile:repo_agent`.
4. Se a ação for `apply_live_model`, use `/byok auto apply profile:repo_agent allow-live-set-model`.
5. Se a ação for `prepare_new_session`, confirme `/session sdk next new` e reinicie a task do terminal.
6. Se a ação for `wait_for_reset`, aguarde o reset/cooldown ou selecione outro perfil/rota.

## Pós-Falha BYOK

Quando uma falha BYOK ocorre no turno vivo, o terminal registra runtime health. Se `COPILOT_BYOK_GATEWAY_AUTO=true`, o
terminal sugere imediatamente:

```text
/byok auto record profile:<perfil>
/byok auto apply profile:<perfil>
```

Isso evita repetir manualmente o mesmo modelo esgotado.

## Limites Atuais

- O controller pré-turno ainda não roda automaticamente antes de toda mensagem.
- Novo boot SDK ainda é comando orientado ao operador.
- Confirmação por `usage/session.model_changed` ainda precisa ser fechada como verificação de aplicação live.
- Testes live LLM-B devem ocorrer apenas após `ops`, readiness e plano estarem limpos.
