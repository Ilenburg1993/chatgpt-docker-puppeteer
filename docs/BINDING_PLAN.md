# Plano de Verificação e Correção de Binding (0.0.0.0)

Resumo curto:

1. Escanear código estático em src/ para ocorrências de binding explícito em `127.0.0.1` ou `localhost`.
2. Executar checagem runtime para portas canônicas (3000,3001,3002,3008,9100,9224).
3. Corrigir código para usar `0.0.0.0` quando apropriado e adicionar logs de boot que exibam o endereço de binding.
4. Integrar verificação em CI e fornecer script de correção (dry-run / --apply).

Ações imediatas:

- Scripts adicionados em `scripts/`:
  - `find-bindings.js` — scanner estático
  - `fix-bindings.js` — codemod (dry-run por padrão; `--apply` para aplicar)
  - `check-bindings.sh` / `.ps1` / `.bat` — verificação runtime
  - `check-all-bindings.sh` — pipeline local que gera `diagnostics/bindings_report.txt`

Próximos passos recomendados:

- Rodar localmente: `./scripts/check-all-bindings.sh` e revisar `diagnostics/bindings_report.txt`.
- Se forem encontradas ocorrências estáticas, revisar manualmente ou rodar `node scripts/fix-bindings.js ./src --apply`.
- Adicionar target no Makefile / job no CI para executar `./scripts/check-all-bindings.sh` antes de testes.
- Atualizar documentação e logs de boot em serviços que façam listen para explicitarem `0.0.0.0`.

Notas:

- Alterações automáticas devem ser tratadas com cuidado (verificar testes e logs).
- Scripts são cross-platform na medida do possível; use `.ps1` / `.bat` quando em Windows.
