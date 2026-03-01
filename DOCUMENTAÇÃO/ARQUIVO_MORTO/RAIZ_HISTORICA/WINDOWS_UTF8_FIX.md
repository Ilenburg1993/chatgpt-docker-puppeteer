# Correção de Caracteres Especiais no Windows (UTF-8)

> **Problema**: Caracteres acentuados aparecem como `├º`, `├║`, `═══` em vez de `ã`, `ú`, `═══`
> **Causa**: Windows CMD usando codepage incorreto (850 ou 437 em vez de 65001 UTF-8)

---

## 🔧 Soluções

### ✅ Solução 1: Automática (Recomendada) - Adicionar chcp nos Scripts

Já corrigido no arquivo `verify-chrome-setup-fixed.bat`:

```batch
@echo off
chcp 65001 >nul 2>&1
REM ... resto do script
```

**Todos os scripts BAT devem ter isso no início.**

---

### ✅ Solução 2: Permanente - Configurar Windows Terminal

Se você usa **Windows Terminal** (recomendado):

1. Abra Windows Terminal
2. Pressione `Ctrl + ,` (Configurações)
3. Vá em **Defaults** (Padrões) ou no perfil específico (CMD, PowerShell)
4. Role até **Advanced** (Avançado)
5. Em **Text encoding**, selecione: `UTF-8`
6. Salve

Ou adicione no `settings.json`:

```json
{
  "profiles": {
    "defaults": {
      "fontFace": "Consolas",
      "fontSize": 10,
      "startingDirectory": "%USERPROFILE%",
      "commandline": "cmd.exe /K chcp 65001"
    }
  }
}
```

---

### ✅ Solução 3: Temporária - Comando Manual

Antes de executar qualquer script, execute:

```batch
chcp 65001
```

**O que cada codepage significa**:

- `437` - US English (padrão antigo)
- `850` - Western European (Latin-1)
- `1252` - Windows Western European
- `65001` - UTF-8 (RECOMENDADO)

---

### ✅ Solução 4: Permanente - Registro do Windows

⚠️ **CUIDADO**: Modifica o registro do Windows

1. Pressione `Win + R`
2. Digite `regedit` e Enter
3. Navegue para: `HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Nls\CodePage`
4. Encontre `OEMCP`
5. Altere o valor de `850` para `65001`
6. Reinicie o computador

**Ou use PowerShell como Administrador**:

```powershell
Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\Nls\CodePage' -Name 'OEMCP' -Value '65001'
```

⚠️ **Nota**: Isso pode afetar outros programas legados.

---

### ✅ Solução 5: Configurar CMD Padrão (Registry)

Criar atalho do CMD que sempre inicia com UTF-8:

1. Crie um arquivo `cmd-utf8.bat`:

```batch
@echo off
chcp 65001 >nul
cmd.exe
```

2. Crie um atalho para esse arquivo
3. Use esse atalho sempre que abrir CMD

---

## 🎯 Teste de Validação

Execute este comando para testar:

```batch
chcp
```

**Saída esperada**:

```
Active code page: 65001
```

Se mostrar `850` ou `437`, o UTF-8 não está ativo.

---

## 📋 Checklist de Configuração

Para garantir caracteres corretos em TODOS os scripts:

- [ ] Adicionar `chcp 65001 >nul 2>&1` no início de todos os `.bat`
- [ ] Configurar Windows Terminal para UTF-8 (se usar)
- [ ] Salvar arquivos `.bat` com encoding UTF-8 (não UTF-8 BOM)
- [ ] Usar fonte que suporta Unicode (Consolas, Cascadia Code, Fira Code)

---

## 🔍 Scripts Atualizados

Já corrigidos com `chcp 65001`:

| Script                          | Status               |
| ------------------------------- | -------------------- |
| `verify-chrome-setup-fixed.bat` | ✅ Corrigido         |
| `start-chrome-proxy.bat`        | ⚠️ Precisa adicionar |
| `LAUNCHER.bat`                  | ⚠️ Precisa adicionar |

---

## 🐛 Troubleshooting

### Problema: Ainda aparece errado mesmo com chcp 65001

**Causa**: Arquivo `.bat` salvo com encoding errado

**Solução**:

1. Abra o arquivo no Notepad++, VS Code ou similar
2. Vá em **File → Save with Encoding → UTF-8** (sem BOM)
3. Salve

---

### Problema: chcp 65001 causa erro "não é reconhecido"

**Causa**: PATH do Windows quebrado ou CMD muito antigo

**Solução**:

1. Abra CMD como Administrador
2. Execute: `sfc /scannow`
3. Reinicie
4. Ou use PowerShell em vez de CMD

---

### Problema: Alguns caracteres ainda aparecem errados

**Causa**: Fonte do terminal não suporta todos os caracteres

**Solução**: Troque a fonte do terminal para uma que suporte Unicode completo:

- **Cascadia Code** (grátis, Microsoft)
- **Fira Code** (grátis, Mozilla)
- **JetBrains Mono** (grátis, JetBrains)
- **Consolas** (padrão Windows, mas suporte limitado)

No Windows Terminal:

1. `Ctrl + ,` (Settings)
2. Perfil → Appearance
3. Font face → Selecione uma fonte Unicode

---

## 📚 Documentação Relacionada

- **Microsoft Docs - Code Pages**: https://docs.microsoft.com/en-us/windows/win32/intl/code-pages
- **Windows Terminal Settings**:
  https://docs.microsoft.com/en-us/windows/terminal/customize-settings/profile-general

---

## ✅ Resumo Rápido

**Para usuário final**:

```batch
REM No início de CADA arquivo .bat:
@echo off
chcp 65001 >nul 2>&1
```

**Para configuração permanente**:

- Windows Terminal → Settings → Default profile → Text encoding: UTF-8

**Para testar**:

```batch
chcp
REM Deve retornar: Active code page: 65001
```

---

**Última Atualização**: 2026-01-30 **Autor**: Claude Code Integration
