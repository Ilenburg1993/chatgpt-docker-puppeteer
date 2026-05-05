# config/system-prompt

**Camada**: L1 declarativa (`config/`) com integração explícita ao SDK via builders compatíveis.

## Arquitetura canônica

- `index.js` — **barrel puro** (imports/exports/JSDoc mínimo)
- `sections-registry.js` — registry estático das 10 seções canônicas do SDK
- `builders.js` — builders estáticos e API pública (`append`, `replace`, `customize`)
- `live-builders.js` — builder de sessão viva com auto-reload via `mode:'customize'` + transforms do
  SDK
- `live-loader.js` — reimport dinâmico de `sections/*.js` por `mtime`, permitindo refletir edições
  nos módulos
- `user-config.js` — config declarativa do usuário (env + `system-prompt.json`)
- `sdk-introspection.js` — wrappers de introspecção do SDK (`instructions.getSources`,
  compatibilidade)
- `status.js` — status efetivo, revisão/digest e política de reload observável para bordas/UX
- `rendering.js` — helpers puros de renderização/merge
- `sdk-defaults/*` — captura/snapshot dos defaults do SDK para auditoria

## Política de modo

Default canônico: **`append`**.

Racional:

- preserva guardrails e seções nativas do SDK;
- evita a substituição total silenciosa do prompt foundation;
- permite convergência incremental com `customize` quando a sessão viva precisa de transforms.

Modos suportados:

- `append` — preferido para uso estático e configuração do usuário;
- `customize` — overlay por seção, compatível com transforms do SDK;
- `replace` — permitido apenas explicitamente; perde guardrails e **não** possui auto-reload
  completo em sessão viva.

## Configuração do usuário

Arquivo declarativo padrão:

- `resolvePersistentConfigFile('system-prompt.json')`

Formato:

```json
{
  "mode": "append",
  "appendFiles": ["./docs/copilot-user-instructions.md"],
  "appendText": "Preferir respostas curtas.",
  "autoReload": true,
  "reloadStrategy": "sdk-transform",
  "objective": "Autoprograme profundamente o src/copilot.",
  "personality": "Rigoroso, ambicioso e cooperativo.",
  "collaborationContract": "Trabalhe junto ao usuário e à LLM-A.",
  "northStar": "Aumentar capacidade de autoprogramação governada.",
  "engineeringDoctrine": "Pensar em owners, fluxos, contratos e observabilidade.",
  "evolutionLoop": "Ler, reprojetar, implementar, validar, documentar e iterar.",
  "focusPaths": ["src/copilot", "src/DOCUMENTAÇÃO/COPILOT"]
}
```

Variáveis de ambiente suportadas:

- `COPILOT_SYSTEM_PROMPT_MODE`
- `COPILOT_SYSTEM_PROMPT_APPEND_FILE`
- `COPILOT_SYSTEM_PROMPT_APPEND_FILES`
- `COPILOT_SYSTEM_PROMPT_APPEND_TEXT`
- `COPILOT_SYSTEM_PROMPT_AUTO_RELOAD`
- `COPILOT_SYSTEM_PROMPT_RELOAD_STRATEGY`
- `COPILOT_SYSTEM_PROMPT_OBJECTIVE`
- `COPILOT_SYSTEM_PROMPT_PERSONALITY`
- `COPILOT_SYSTEM_PROMPT_COLLABORATION_CONTRACT`
- `COPILOT_SYSTEM_PROMPT_NORTH_STAR`
- `COPILOT_SYSTEM_PROMPT_ENGINEERING_DOCTRINE`
- `COPILOT_SYSTEM_PROMPT_EVOLUTION_LOOP`
- `COPILOT_SYSTEM_PROMPT_FOCUS_PATHS`
- `COPILOT_SYSTEM_PROMPT_CONFIG`

## Semântica de carregamento/reload

### Create / resume

O SDK envia `systemMessage` tanto em `createSession` quanto em `resumeSession`.

Logo:

- **novas sessões** usam sempre o prompt mais recente;
- **resume** também reaplica o prompt atualizado.

### Sessão viva / edição durante a sessão

Quando `autoReload=true` e o modo efetivo é `append` ou `customize`, o agent usa
`buildLiveSystemMessage()`:

- wire mode: `customize`
- section actions: `SectionTransformFn` assíncronos
- cada transform recarrega:
  - os módulos `sections/*.js` por `mtime`
  - arquivos de customização do usuário
  - contexto dinâmico do hook system (na seção `guidelines`)

Isso significa que, **sempre que o SDK pedir `systemMessage.transform`**, o conteúdo refletirá a
versão mais nova.

## Superfícies de observabilidade canônicas

- `readSystemPromptStatus()` / `readSystemPromptStatusSync()` — configuração efetiva, arquivos
  observados, digest de revisão, compatibilidade do SDK e política de reload.
- `buildSystemPromptBindingSnapshot()` / `evaluateSystemPromptFreshness()` — correlacionam a revisão
  atual do prompt com a sessão SDK viva e deixam explícito quando o runtime depende de resume para
  reaplicar instruções.
- `readSessionInstructionSources(session)` — introspeciona via RPC do SDK as instruction sources da
  sessão viva.
- `GET /api/sdk/agent/system-prompt` — adapter HTTP canônico para status + instruction sources do
  runtime ativo.
- `/sdk prompt` — UX terminal canônica para inspeção rápida do prompt/config/reload, incluindo
  binding persistido e freshness.

### Compaction

O SDK emite `session.compaction_*`, mas **compaction sozinha não é garantia de re-leitura de
arquivos locais**.

A reavaliação automática depende do runtime do SDK solicitar `systemMessage.transform` novamente.

### Limitação honesta atual

Em `mode:'replace'`, o SDK não oferece RPC canônica para trocar o system prompt inteiro de uma
sessão já aberta.

Portanto:

- `replace` continua funcionando em `create/resume`;
- porém o auto-reload de sessão viva é **parcialmente limitado pelo próprio SDK**;
- para reload total garantido de `replace`, é preciso nova criação/resume da sessão.

O status canônico expõe essa limitação explicitamente em `limitations[]`, além de informar se a
sessão viva está sob `sdk-transform` ou snapshot estático.

## Binding / freshness / inject

O runtime agora persiste um `systemPromptBinding` no estado do agent sempre que cria ou retoma uma
sessão SDK. Esse binding contém o digest da revisão aplicada, o modo efetivo e o mecanismo de reload
vigente naquele momento.

As projections canônicas passam a expor também o `systemPromptFreshness`, que responde se a sessão
atual está stale, por quê, e qual ação é recomendada (`none`, `observe-live-reload`,
`resume-session`).

Esse estado não fica restrito a `/sdk prompt`: ele agora sobe também para as superfícies canônicas
de runtime (`runtime-overview`), HTTP (`/health`, `/config`) e terminal (`/status`, `/metrics`),
reduzindo o troubleshooting do prompt a uma única cadeia de leitura.

O histórico canônico de `/inject` também passou a carregar digest/freshness do prompt, permitindo
correlacionar latência e comportamento do runtime com a revisão do system prompt sem abrir uma
superfície paralela de diagnose.

Além disso, `/metrics` passou a expor o último inject com duração, timeout efetivo, outcome e
digest/frescor do prompt associado, tornando a auditoria de latência uma extensão do fluxo canônico
de observabilidade em vez de um relatório avulso.

## Compatibilidade SDK auditada

Superfícies confirmadas no SDK local (`@github/copilot-sdk`):

- `SessionConfig.systemMessage`
- `ResumeSessionConfig.systemMessage`
- `mode:'append' | 'replace' | 'customize'`
- `SectionTransformFn`
- RPC `session.instructions.getSources`
- callback interno `systemMessage.transform`

## Regra arquitetural 2.1

`index.js` deve ser **barrel puro**.

Toda lógica operacional, parsing, composição, I/O, watch/reload e builders concretos devem viver em
módulos semânticos dedicados.
