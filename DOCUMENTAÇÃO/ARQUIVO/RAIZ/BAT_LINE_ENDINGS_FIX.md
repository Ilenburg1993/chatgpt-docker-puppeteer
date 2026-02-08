# Correção de Line Endings em Arquivos .BAT

> **Problema**: Scripts `.bat` criados no Linux não funcionam no Windows
> **Causa**: Line endings LF (Linux) em vez de CRLF (Windows)
> **Sintoma**: Comandos aparecem quebrados, partes do código executam como comandos

---

## 🐛 Problema Identificado

Quando arquivos `.bat` são criados em ambiente Linux (container Docker, WSL, Git Bash), eles usam **LF** (`\n`) como quebra de linha.

Windows CMD espera **CRLF** (`\r\n`).

### Sintomas

```
'inuar' não é reconhecido como comando
'=config.json' não é reconhecido como comando
'cho' não é reconhecido como comando
```

Isso acontece porque o Windows interpreta mal as linhas e quebra comandos no meio.

---

## ✅ Solução Aplicada

Todos os arquivos `.bat` foram convertidos para CRLF:

```bash
sed -i 's/$/\r/' arquivo.bat
```

Arquivos corrigidos:
- ✅ `verify-chrome-setup.bat`
- ✅ `start-chrome-proxy.bat`
- ✅ `verify-chrome-setup-debug.bat`
- ✅ `verify-chrome-setup-no-close.bat`

---

## 🔧 Como Converter Manualmente

### Opção 1: No Windows (usando PowerShell)

```powershell
# Converter LF para CRLF
(Get-Content arquivo.bat -Raw) -replace "`n", "`r`n" | Set-Content arquivo.bat -NoNewline
```

### Opção 2: No Linux/WSL

```bash
# Instalar dos2unix se necessário
sudo apt-get install dos2unix

# Converter
unix2dos arquivo.bat
```

### Opção 3: No Git Bash (Windows)

```bash
sed -i 's/$/\r/' arquivo.bat
```

### Opção 4: Visual Studio Code

1. Abra o arquivo `.bat`
2. Canto inferior direito, clique em **LF**
3. Selecione **CRLF**
4. Salve (`Ctrl + S`)

### Opção 5: Notepad++

1. Abra o arquivo
2. Menu **Edit → EOL Conversion → Windows (CRLF)**
3. Salve

---

## 🛡️ Prevenção

### Git Configuration

Configure Git para converter automaticamente:

```bash
# Global (todos os repositórios)
git config --global core.autocrlf true

# Local (apenas este repositório)
git config core.autocrlf true
```

### .gitattributes

Crie/edite `.gitattributes` na raiz do projeto:

```
# Force CRLF for .bat files
*.bat text eol=crlf

# Force LF for .sh files
*.sh text eol=lf

# Auto-detect for other files
* text=auto
```

---

## 🔍 Como Verificar Line Endings

### No Linux/WSL

```bash
file arquivo.bat
# Saída esperada: "ASCII text, with CRLF line terminators"
# Saída com erro: "ASCII text" (sem CRLF)
```

### No Windows (PowerShell)

```powershell
# Ver conteúdo raw
Get-Content arquivo.bat -Raw | Format-Hex
# Procure por: 0D 0A (CRLF correto) vs apenas 0A (LF incorreto)
```

### Visual Studio Code

Olhe no canto inferior direito:
- ✅ **CRLF** - Correto para Windows
- ❌ **LF** - Incorreto para Windows

---

## 📋 Checklist

Quando criar ou editar arquivos `.bat`:

- [ ] Arquivo salvo com encoding **UTF-8** (sem BOM)
- [ ] Line endings configurados para **CRLF**
- [ ] `.gitattributes` configurado
- [ ] Testado no Windows antes de commitar

---

## 🎯 Teste de Validação

Após converter, execute:

```batch
verify-chrome-setup.bat
```

**Saída esperada**: Script executa sem erros de "comando não reconhecido"

**Saída com erro**: Mensagens como `'inuar' não é reconhecido`

---

## 📚 Referências

- **Microsoft Docs**: [Batch Files Line Endings](https://docs.microsoft.com/en-us/windows/win32/fileio/file-management-functions)
- **Git Docs**: [core.autocrlf](https://git-scm.com/book/en/v2/Customizing-Git-Git-Configuration#_core_autocrlf)
- **EditorConfig**: [.editorconfig for line endings](https://editorconfig.org/)

---

**Última Atualização**: 2026-01-30
**Problema Resolvido**: Line endings CRLF aplicados em todos os arquivos .bat
