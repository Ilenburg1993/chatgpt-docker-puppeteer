# JSDoc Node 24 Patterns

Preferred phase 2 patterns:

- `@typedef {object} Options` plus `@property`
- `@returns {Promise<T>}` for async APIs
- `@template T` only when the API is actually generic
- inline `import('./file').Type` or `@import` for shared types
- `@satisfies` for object literals that must match a stable shared contract

Avoid in public contracts:

- `Object`
- `Array`
- `Function`
- `Promise<any>`
- `any` unless the contract is intentionally dynamic and explicitly justified
