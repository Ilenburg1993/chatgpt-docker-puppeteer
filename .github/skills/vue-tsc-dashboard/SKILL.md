---
name: vue-tsc-dashboard
description: Governa a tipagem do workspace src/dashboard-ui com vue-tsc. Use quando modificar componentes Vue, adicionar stores Pinia, tipar configs Vite/Tailwind ou corrigir erros de vue-tsc --noEmit.
license: MIT
---

# Skill — Vue TSC Dashboard

## Overview

Este skill governa o contrato estático do workspace `src/dashboard-ui`, usando
`vue-tsc` como ferramenta de typecheck oficial de Single File Components (SFCs) Vue.

> O Vite dev server é transpilation-only e **não valida tipos**. O typecheck real é
> feito por `vue-tsc --noEmit`.

O script canônico é:

```sh
npm run typecheck:dashboard
```

## When To Use

-   Modificar componentes `.vue` (Options API, Composition API, `<script setup>`)
-   Adicionar ou alterar stores Pinia
-   Tipar props, emits ou slots de componentes Vue
-   Corrigir erros reportados por `vue-tsc`
-   Configurar ou atualizar `src/dashboard-ui/tsconfig.json`
-   Tipar `vite.config.js`, `tailwind.config.js` ou `postcss.config.js`

## When Not To Use

-   O task envolve apenas o runtime Node.js (`src/**` fora do dashboard) → use `typing-node24-esm-tsserver`
-   O task envolve apenas JSDoc em arquivos `.js` do servidor → use `jsdoc-authoring`
-   O task envolve criação/manutenção de lanes strict → use `strict-lane-governance`

## Inputs / Preconditions

-   `vue-tsc` e `@vue/tsconfig` devem estar instalados no workspace `src/dashboard-ui`
-   `src/dashboard-ui/tsconfig.json` deve existir com `strict: true`
-   Componentes `.vue` devem usar `<script setup lang="ts">` ou `<script lang="ts">`
    quando o typecheck exigir tipagem não-inferível

## Workflow

1. Verificar instalação: `npm --workspace src/dashboard-ui list vue-tsc`.
2. Rodar `npm run typecheck:dashboard` para ver o estado atual dos erros.
3. Para SFCs com erros em `this` caindo em `any` (Options API):
    -   Migrar para `<script setup lang="ts">` com Composition API, ou
    -   Adicionar `defineComponent` com interface de retorno explícita.
4. Para props sem tipo:
    ```vue
    <script setup lang="ts">
    const props = defineProps<{ title: string; count: number }>();
    </script>
    ```
5. Para emits sem tipo:
    ```vue
    const emit = defineEmits<{ update: [value: string]; close: [] }>();
    ```
6. Para stores Pinia com estado genérico:
    ```ts
    const useUiStore = defineStore('ui', () => {
        const count = ref<number>(0);
        return { count };
    });
    ```
7. Para configs de raiz do dashboard (`vite.config.js`, etc.):
    -   Adicionar `// @ts-check` + `import { defineConfig } from 'vite'`.
    -   `tailwind.config.js`: `/** @type {import('tailwindcss').Config} */` antes do export.
    -   `postcss.config.js`: `/** @type {Record<string, object>} */` antes do export.
8. Rodar `npm run typecheck:dashboard` novamente e verificar zero erros.

## Guardrails

-   Não reescrever Options API para Composition API apenas por estética — somente quando o typecheck exigir.
-   Não usar `@ts-ignore` em SFCs; preferir `// @ts-expect-error` com comentário explicativo.
-   Props e emits devem ter tipos reais, não `any` ou `unknown` desnecessário.
-   Manter `verbatimModuleSyntax: true` no `tsconfig.json` do dashboard.
-   Não introduzir dependências TypeScript no dashboard além de `vue-tsc` e `@vue/tsconfig`.

## Validation / Done Criteria

-   [ ] `npm run typecheck:dashboard` executa `vue-tsc --noEmit` sem erros.
-   [ ] Props e emits de componentes públicos têm tipos explícitos não-`any`.
-   [ ] `src/dashboard-ui/vite.config.js` tem `// @ts-check` e usa `defineConfig`.
-   [ ] `npm --workspace src/dashboard-ui run build` continua verde.
-   [ ] `npm run jsdoc:coverage:json` fecha com `missing_param = 0`, `unsafe_generic = 0`.

## Related Skills

-   [`../typing-node24-esm-tsserver/SKILL.md`](../typing-node24-esm-tsserver/SKILL.md)
-   [`../strict-lane-governance/SKILL.md`](../strict-lane-governance/SKILL.md)
-   [`../jsdoc-authoring/SKILL.md`](../jsdoc-authoring/SKILL.md)
-   [TYPING_FULLSTRICT_ROADMAP.md](../../../DOCUMENTAÇÃO/PLANOS/TYPING_FULLSTRICT_ROADMAP.md)
