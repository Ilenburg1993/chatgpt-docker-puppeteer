# CHECKLIST 01: Gate de Typecheck (TS como ferramenta oficial)

Objetivo
- Criar um gate oficial de tipagem via `tsc --noEmit`.
- A tipagem passa a ser “contrato verificavel” (nao so IntelliSense).

Checklist
- [ ] Adicionar `typescript` como `devDependency` (versao fixada ou range controlado).
- [ ] Criar `tsconfig.typecheck.json`.
- [ ] Adicionar script `npm run typecheck`.
- [ ] Manter `jsconfig.json` como esta (por enquanto) para nao explodir ruido no editor. O gate sera via `tsc`.
- [ ] Rodar `npm run typecheck` local.

Recomendacao de configuracao inicial (minima, pragmatica)
- [ ] `allowJs: true`
- [ ] `checkJs: true`
- [ ] `noEmit: true`
- [ ] `module` e `moduleResolution`: `NodeNext`
- [ ] `baseUrl` e `paths`: iguais ao `jsconfig.json`
- [ ] `exclude`: manter `src/dashboard-ui/**` fora do primeiro ciclo

Comandos (referencia)
```bash
npm i -D typescript
npm run typecheck
```

Definição de Pronto (DoD)
- Existe `npm run typecheck`.
- `npm run typecheck` falha com erro real quando existe problema, e fica verde quando corrigido.
- O time concorda: “verde no typecheck” = requisito para merge.

Riscos comuns
- `typeRoots` e `.d.ts` internos podem mascarar ou distorcer tipos. O proximo checklist trata disso.

---
Arquivo gerado automaticamente por solicitação. Não farei commit/push sem sua autorização.
