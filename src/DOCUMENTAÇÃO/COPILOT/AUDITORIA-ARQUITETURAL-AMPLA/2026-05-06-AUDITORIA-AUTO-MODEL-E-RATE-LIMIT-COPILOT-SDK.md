# Auditoria Auto Model e Rate Limit no Copilot SDK

Data: 2026-05-06

Escopo: `src/copilot`, especialmente criação/retomada de sessão SDK, fallback de modelo, recovery
policy do terminal e integração live LLM-B.

## 1) Fonte externa canônica

A documentação oficial do GitHub Copilot distingue dois limites de uso:

- limite de sessão: ao atingir esse limite, é necessário aguardar o reset antes de continuar;
- limite semanal de 7 dias: quando ainda há premium requests disponíveis, o Copilot pode continuar
  com seleção `Auto` de modelo, e a escolha manual volta após o reset semanal.

Fonte: <https://docs.github.com/en/copilot/concepts/usage-limits>

Conclusão de segurança: o SDK local deve maximizar uso permitido via `model: "auto"`, fallback
explícito e degradação controlada, mas não deve tentar evadir rate limits, contornar termos ou
repetir reconnects que aumentam consumo.

## 2) Situação encontrada

- O default canônico do runtime LLM-B já é `DEFAULT_COPILOT_MODEL = "auto"` em
  `src/copilot/config/agent.js`.
- `createSession()` e `resumeSession()` já preservam `model: "auto"` até o SDK e omitem
  `reasoningEffort` quando o modelo efetivo será decidido pelo próprio Copilot.
- `resolveSessionCreateModel()` continua existindo para fluxos que precisam de modelo concreto, mas
  não é usado no caminho canônico de criação/retomada da sessão.
- O teste live com `terminal:llm-b` observou erro de sessão:
  `Please wait for your limit to reset in 18 minutes`. Esse caso não deve recomendar Auto como
  contorno imediato.

## 3) Gap corrigido nesta rodada

Antes, a recovery policy apresentava todo `429/rate_limit` como se `/model auto` fosse sempre uma
ação adequada.

Correções:

- `presentation/sdk-recovery-policy.js` passou a classificar subescopos: `session`, `weekly_model` e
  `unknown`.
- Mensagens de limite de sessão agora orientam aguardar o reset e deixam explícito que `/model auto`
  não contorna limite de sessão ativo.
- Mensagens de limite semanal/modelo recomendam `/model auto` + `/restart` como uso permitido da
  política nativa do Copilot.
- `sdk/errors.js` ganhou a mesma classificação semântica para decisões internas.
- `hooks/session-hooks.js` deixou de agendar fallback automático quando a mensagem indica limite de
  sessão; o evento de erro continua sendo emitido normalmente.

## 4) Contrato operacional desejado

- `model=auto` deve chegar ao SDK como seleção nativa, não como placeholder resolvido localmente.
- `reasoningEffort` deve ser omitido enquanto `auto` decide o modelo efetivo.
- `rate_limit` de sessão deve bloquear reconnect/fallback automático e preservar terminal/HTTP/REPL.
- `rate_limit` semanal/modelo pode sugerir troca para Auto, desde que por comando explícito do
  operador ou configuração declarativa.
- `429` genérico deve ser tratado de forma conservadora: não abrir circuito local nem prometer
  bypass; a mensagem humana deve pedir leitura do reset/escopo retornado pelo SDK.

## 5) Implicação para sessões contínuas live

Para dialog loop contínuo, realtime e streaming, a arquitetura correta é:

1. manter host local vivo mesmo com bloqueio externo do SDK;
2. exibir o escopo provável do rate limit;
3. não entrar em restart loop;
4. preservar `/status`, `/sdk quota`, `/sdk waits`, `/permission pending` e `/restart`;
5. permitir `/model auto` somente como estratégia de uso permitido para limite semanal/modelo.

## 6) Próximos testes live

Quando o limite de sessão resetar:

- repetir `npm run terminal:llm-b`;
- executar um turno curto real para validar streaming;
- confirmar que `configuredModel=auto` permanece distinto de `effectiveModel/billedModel` quando o
  SDK reportar metadata;
- validar `/model auto` + `/restart` apenas se a mensagem futura indicar limite semanal/modelo, não
  limite de sessão.

## 7) Reteste live no mesmo dia

Novo `npm run terminal:llm-b` validou o caminho permitido de Auto model:

- `model="auto"` permaneceu como configuração no runtime;
- SDK roteou para `claude-haiku-4.5`;
- `/status`, `/sdk quota`, `/health` e `/config` ficaram operáveis;
- um turno curto retornou resposta live em aproximadamente `2.3s`;
- quota semanal reportou `remaining=0.0%`, mas `Auto` ainda encontrou rota permitida.

Esse resultado reforça a distinção:

- limite semanal/modelo: usar Auto é caminho compatível com a política oficial;
- limite de sessão: aguardar reset continua obrigatório.

## 8) Auditoria concreta do `Auto` model

Fonte oficial complementar:
<https://docs.github.com/en/copilot/using-github-copilot/ai-models/choosing-the-right-ai-model-for-your-task#model-comparison>

Critérios públicos do GitHub Copilot para seleção `Auto`:

- disponibilidade dos modelos para a conta/organização;
- saúde operacional em tempo real;
- performance esperada para a tarefa;
- menor chance de rate limit, erro e latência;
- políticas administrativas da organização;
- plano/assinatura;
- exclusão de modelos com multiplicador de premium request maior que `1`.

Conclusão: a autoridade de seleção do `Auto` é do GitHub Copilot. O SDK local pode escolher
`model="auto"` e observar o resultado efetivo/cobrado, mas não há contrato público para declarar
`auto` com preferência forçada por `gpt-5.4/high`.

## 9) Preferência local implementada

Foi adicionado um contrato local de observabilidade, não de bypass:

- preferência local default: `gpt-5.4/high`;
- `selectionAuthority="github-copilot"`;
- `canForcePreference=false`;
- critérios públicos e classes excluídas projetados no SDK;
- overrides declarativos via ambiente para auditoria controlada: `COPILOT_AUTO_PREFERRED_MODEL`,
  `COPILOT_AUTO_PREFERRED_REASONING_EFFORT` e `COPILOT_AUTO_PREFERENCE_ENABLED`.

Arquivos principais:

- `src/copilot/sdk/models/auto-policy.js`;
- `src/copilot/agent/facades/agent-model-config.js`;
- `src/copilot/presentation/runtime-models.js`;
- `src/copilot/terminal/commands/config.js`;
- `src/copilot/terminal/commands/session.js`;
- `src/copilot/terminal/frontend/projections/config.js`.

## 10) Teste live de preferência e roteamento

Novo `npm run terminal:llm-b` validou:

- `/model` com `model=auto` mostra autoridade GitHub Copilot, preferência local `gpt-5.4/high`,
  último modelo observado e se a preferência foi satisfeita;
- `/model list` retornou modelos disponíveis, incluindo `gpt-5.4`, `gpt-5.3-codex`, `gpt-5.2-codex`,
  `gpt-5.2`, `gpt-5.4-mini`, `gpt-5-mini`, `gpt-4.1`, `claude-sonnet-4.6`, `claude-sonnet-4.5`,
  `claude-haiku-4.5`, `claude-sonnet-4` e `auto`;
- tentativa manual `/model gpt-5.4` atualizou a configuração local, mas o SDK live não convergiu
  positivamente para o modelo concreto nessa sessão; o runtime continuou reportando `auto`;
- retorno para `/model auto` preservou a seleção nativa do Copilot e explicou que `gpt-5.4/high` é
  preferência local observável, não parâmetro oficial forçado;
- turno curto `Responda exatamente: OK-AUTO-POLICY` completou com roteamento efetivo para
  `claude-haiku-4.5`.

Conclusão operacional: podemos selecionar implicitamente `Auto` usando `model="auto"` e registrar
uma preferência local `gpt-5.4/high` para observabilidade/auditoria. Não foi encontrada forma
suportada pelo SDK atual para enviar “Auto com preferência gpt-5.4/high” como política vinculante.

## 11) Correção de metadata observada

Durante o teste, eventos de usage podiam manter `effectiveModel="auto"` mesmo quando
`billedModel="claude-haiku-4.5"`. Isso apagava o modelo concreto da política Auto no `/status`.

Correção aplicada:

- `src/copilot/event-handlers/usage.js` agora normaliza `effectiveModel=auto` para o modelo cobrado
  quando o SDK fornece `billedModel`;
- `/status` usa metadata do modelo observado quando o configurado é `auto`;
- o reteste live passou a exibir `perfil modelo cost=medium · speed=fast · ctx=200.000` e
  `auto policy pref=gpt-5.4/high · autoridade=GitHub Copilot · último=claude-haiku-4.5`.

## 12) Gates finais desta trilha

- `npm run typecheck:strict:src.copilot`: verde.
- `npm run lint`: verde.
- `npm run check:copilot:guardrails`: verde.
- `npm run test:copilot:unit`: verde (`146` arquivos, `2.426` testes).
