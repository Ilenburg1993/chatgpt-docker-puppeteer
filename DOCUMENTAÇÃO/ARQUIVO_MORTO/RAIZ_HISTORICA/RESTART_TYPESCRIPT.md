# 🔄 Como Recarregar o TypeScript Server

**Passo 1:** Abra a Command Palette

- **Mac:** Cmd + Shift + P
- **Windows/Linux:** Ctrl + Shift + P

**Passo 2:** Digite e selecione:

```
TypeScript: Restart TS Server
```

**Passo 3:** Aguarde ~10-15 segundos para reindexação

**Passo 4:** Verifique o painel PROBLEMAS (Ctrl+Shift+M)

- Deve ter MUITO menos erros
- Os erros TS2769, TS2345, TS2339 principais devem ter desaparecido

---

## 📊 Erros que Devem Ser Resolvidos

✅ **TS2769** - "No overload matches this call" (schemas com Object.freeze) ✅ **TS2345** -
"Argument of type 'this' is not assignable" (BaseDriver) ✅ **TS2339** - "Property does not exist"
(Error.details, config properties, etc.) ✅ **TS2322** - Type mismatches (propriedades dinâmicas)

---

## 🧪 Testar se Funcionou

Execute o diagnóstico novamente após reload:

```bash
node diagnostic-full.mjs 2> /dev/null | head -50
```

**Expectativa:** Redução de ~100-120 erros (de 173 → ~50-60)
