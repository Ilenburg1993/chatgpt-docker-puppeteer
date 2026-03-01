---
name: reactive-bug-audit
user-invokable: true
description:
  'Skill reativa para conduzir auditoria focada em correção de bugs operacionais. Use quando houver
  erro reportado, stack trace, comportamento quebrado ou regressão já observada.'
---

# reactive-bug-audit

## Overview

Skill reativa para defeitos já observados. Ela parte de uma pista concreta: stack trace, log,
regressão, screenshot, relato funcional ou arquivo suspeito.

## Recommended Tuple

- `audit_mode=reactive_bug`
- `profile=quick` para triagem inicial
- `profile=deep` para P0/P1 ou persistência do defeito
- `proposal_depth=standard|deep`

## When To Use

- Há um bug reproduzível ou um incidente com evidência inicial.
- Há stack trace, erro de runtime, failing test ou regressão específica.
- É necessário sair de sintoma para causa-raiz e patch mínimo.

## When Not To Use

- Não usar sem pista inicial; nesse caso usar `exploratory-bug-hunt`.
- Não usar como runbook operacional; usar `audit-runbook-observability`.
- Não usar para uma proposta P0/P1 final sem passar por `audit-proposal-deep-triage`.

## Inputs / Preconditions

- bug report, stack trace ou evidência inicial
- `npm run audit:preflight`
- `npm run audit:reactive-bug-audit` ou `npm run audit:quick`
- referências:
  - `references/reactive-triage-prompt.md`
  - `references/evidence-template.md`
  - `references/reproduction-playbook.md` ← novo

## Workflow

### 1. Consolidar a Pista Inicial

- Registrar o sintoma exato: mensagem de erro, arquivo afetado, condição de reprodução.
- Identificar se é crash, regressão, comportamento inesperado ou degradação.
- Verificar se o problema existe no código atual (não em versão antiga).

### 2. Localizar o Epicentro

```bash
# Buscar por texto do erro no código
grep -rn "mensagem_do_erro" src/ --include="*.js"

# Buscar pelo arquivo mencionado no stack trace
grep -rn "arquivo_mencionado" src/ --include="*.js"

# Buscar por padrão relacionado ao comportamento
grep -rn "função_relevante\|método_relevante" src/ --include="*.js"
```

### 3. Reproduzir Localmente

- Verificar se o teste existente reproduz o problema.
- Se não, identificar qual teste unitário cobre o caminho afetado.
- Executar o teste isoladamente: `node --test tests/unit/modulo/teste.spec.js`

### 4. Análise de Causa-Raiz

Verificar hipóteses em ordem de probabilidade:

1. **Lógica de controle**: condição invertida, branch morto, flag nunca resetada.
2. **Async/await**: faltando `await`, race condition, unhandled rejection.
3. **Estado compartilhado**: mutação inesperada, singleton não reinicializado.
4. **Integração externa**: API externa com comportamento alterado, timeout.
5. **Resource leak**: timer/listener acumulando, causa degradação progressiva.

### 5. Validar Hipótese

- Adicionar log temporário para confirmar hipótese antes de aplicar patch.
- Verificar se o bug se manifesta em todos os caminhos suspeitos.
- Confirmar que a causa-raiz está na versão atual do código.

### 6. Aplicar Patch Mínimo

- Mudança cirúrgica — mínimo de linhas necessárias.
- Rodar teste específico após patch.
- Rodar `npm run test:unit` completo para detectar regressões.
- Se P0/P1, escalar para `audit-proposal-deep-triage`.

### 7. Reexecutar Auditoria

- Verificar que o finding original não se reproduz mais.
- Registrar a correção no tracker/relatório.

## Playbook de Reprodução Rápida

Para erros de runtime:

```bash
# 1. Verificar se o erro é na versão atual
node --test tests/unit/ 2>&1 | grep -A5 "failing\|Error"

# 2. Isolar o teste que falha
node --test tests/unit/modulo/arquivo.spec.js 2>&1 | head -50

# 3. Adicionar log no ponto suspeito e rodar novamente
# (adicionar console.log temporário, rodar, remover)

# 4. Verificar imports/exports do arquivo afetado
node -e "import('./src/modulo/arquivo.js').then(console.log).catch(console.error)"
```

## Guardrails

- Não misturar fluxo exploratório dentro desta skill.
- Não abrir escopo sem necessidade; começar no menor conjunto reproduzível.
- Não aplicar patch sem validação mínima local.
- Sempre vincular o achado a tracker, arquivo e evidência.

## Validation / Done Criteria

- Causa-raiz identificada com evidência concreta.
- Patch validado: `npm run test:unit` sem regressões.
- `npm run lint` sem novos erros.
- Reexecução não reproduz o finding principal.
- Evidência registrada no tracker ou relatório da rodada.

## Related Skills

- `audit-runbook-observability` para baseline e artefatos.
- `audit-proposal-deep-triage` para proposta profunda.
- `exploratory-bug-hunt` para cenários sem pista inicial.
- `code-audit-and-fix` para ciclo completo de auditoria e correção.
