# core/errors.js — Auditoria

**Módulo**: `src/copilot/core/` **Arquivo**: `errors.js` **LOC**: 63 | **Score**: 9.0/10

## Responsabilidade

Hierarquia de erros semânticos:

```
Error
└── CopilotError (code='COPILOT_ERROR')
    ├── SessionError (code='SESSION_ERROR')
    └── BridgeError (code='BRIDGE_ERROR')
```

Todos os erros carregam `this.code` para discriminação sem `instanceof` aninhado.

## Achados

### P5 — `Error.captureStackTrace` não chamado explicitamente

**Localização**: `errors.js:26` — `constructor(message, code)`

**Descrição**: Em Node.js/V8, chamar `Error.captureStackTrace(this, this.constructor)` remove o
frame do construtor da classe de erro do stack trace, tornando-o mais limpo na exibição. Sem isso, o
stack inclui `new CopilotError (errors.js:26)` como primeiro frame, obscurecendo o ponto de origem
real.

```js
// Melhoria opcional
constructor(message, code = 'COPILOT_ERROR') {
    super(message);
    this.name = 'CopilotError';
    this.code = code;
    if (Error.captureStackTrace) {
        Error.captureStackTrace(this, this.constructor);
    }
}
```

**Impacto**: Apenas ergonomia de debugging — não afeta funcionalidade.

---

## Destaques Positivos

- Três níveis de hierarquia com codes distintos — discriminação por `err.code` sem instanceof
  cascading
- Constructors com parâmetro `code` opcional com default sensato — backward compatible
- `this.name` definido corretamente após `super()` — pattern ES6 correto para subclasses de Error
- JSDoc com `@extends` e `@param` explícitos em todas as classes

---

_Gerado automaticamente pelo COPILOT-FULL-AUDIT MF-II._
