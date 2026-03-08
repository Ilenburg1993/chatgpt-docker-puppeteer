# Bug Patterns Catalog

Catálogo de padrões de bug mais comuns neste projeto, para uso na varredura grep-first.

## Timer Leaks (C1)

```js
// PROBLEMA: setTimeout sem referência salva
setTimeout(() => this._attachSensoryListeners(), 5000);

// CORREÇÃO:
this._retryTimer = setTimeout(() => {
  this._retryTimer = null;
  this._attachSensoryListeners();
}, 5000);
// E em stop(): clearTimeout(this._retryTimer)
```

## Async setTimeout sem catch (C2)

```js
// PROBLEMA: unhandled rejection se fn() lançar
setTimeout(async () => {
  await fn();
}, delay);

// CORREÇÃO:
setTimeout(() => {
  fn().catch((err) => log('ERROR', err.message));
}, delay);
```

## Reentrância em setInterval async (C2)

```js
// PROBLEMA: múltiplas coletas concorrentes
setInterval(async () => {
  await collect(); // se demorar mais que o intervalo = concorrência
}, 1000);

// CORREÇÃO:
let _collecting = false;
setInterval(async () => {
  if (_collecting) return;
  _collecting = true;
  try {
    await collect();
  } finally {
    _collecting = false;
  }
}, 1000);
```

## Null dereference em estado UNATTACHED (C4)

```js
// PROBLEMA: page pode ser null em drivers desconectados
const browser = this.driver.page.browser();

// CORREÇÃO:
const page = this.driver.page;
if (!page) {
  throw err;
}
const browser = page.browser();
```

## Circuit breaker invertido (C5)

```js
// PROBLEMA: .catch reseta antes de .then verificar
promise
  .catch(() => {
    failures++;
  })
  .then(() => {
    failures = 0;
  }); // executa mesmo após catch!

// CORREÇÃO:
promise
  .then(() => {
    failures = 0;
  })
  .catch(() => {
    failures++;
  });
```

## parseInt sem radix (C6)

```js
// PROBLEMA: comportamento ambíguo com strings "0x" ou "08"
parseInt(process.env.PORT || '3000');

// CORREÇÃO:
parseInt(process.env.PORT || '3000', 10);
```

## HTTP 200 para não-implementado (C10)

```js
// PROBLEMA: clientes assumem sucesso
res.json({ message: 'not implemented' });

// CORREÇÃO:
res.status(501).json({ status: 'not_implemented', message: 'not implemented' });
```

## Timeout sem cancel após Promise.race (C1)

```js
// PROBLEMA: timer vaza após race resolver
await Promise.race([op(), _timeout(5000)]);

// CORREÇÃO:
const t = _timeout(5000);
try {
  await Promise.race([op(), t.promise]);
} finally {
  t.cancel();
}
```

## structuredClone vs JSON.parse/stringify (C9)

```js
// PROBLEMA: lento e não suporta tipos especiais
const copy = JSON.parse(JSON.stringify(obj));

// CORREÇÃO (Node.js 17+):
const copy = structuredClone(obj);
```
