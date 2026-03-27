// @ts-check
/**
 * Script de Análise de Variáveis e Constantes Analisa todo o código-fonte e identifica variáveis, categorizando por
 * tipo e escopo
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// Configurações de análise
const CONFIG = {
    includeDirs: ['src', 'scripts', 'agents'],
    excludeDirs: ['node_modules', 'dist', 'build', '.git', 'dashboard-ui'],
    extensions: ['.js', '.mjs', '.ts'],
    excludeFiles: ['analyze-variables.mjs', 'analyze-variables.js'],
};

// Armazenamento de dados coletados
/** @type {any} */
const analysisData = {
    files: [],
    globalPublic: [],
    globalPrivate: [],
    local: [],
    constants: [],
    functions: [],
    classes: [],
    issues: {
        unused: [],
        duplicates: [],
        magicValues: [],
        redundantLet: [],
    },
    dependencies: new Map(),
    enumCandidates: new Map(),
    typeCandidates: [],
};

// ============================================
// CLASSE: FileScanner
// ============================================
class FileScanner {
    /**
     * @param {any} config
     */
    constructor(config) {
        this.config = config;
        /** @type {string[]} */
        this.files = [];
    }

    /**
     * @param {string} filePath
     * @returns {boolean}
     */
    shouldInclude(filePath) {
        const ext = path.extname(filePath);
        const relativePath = path.relative(PROJECT_ROOT, filePath);

        // Verificar extensão
        if (!this.config.extensions.includes(ext)) return false;

        // Verificar arquivos excluídos
        if (this.config.excludeFiles.includes(path.basename(filePath))) return false;

        // Verificar diretórios excluídos
        for (const excludeDir of this.config.excludeDirs) {
            if (relativePath.includes(`${excludeDir}/`) || relativePath.includes(`${excludeDir}\\`)) {
                return false;
            }
        }

        return true;
    }

    /**
     * @param {string} dirPath
     */
    scanDir(dirPath) {
        let entries;
        try {
            entries = fs.readdirSync(dirPath, { withFileTypes: true });
        } catch (_err) {
            console.warn(`⚠️  Não foi possível ler diretório: ${dirPath}`);
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);

            if (entry.isDirectory()) {
                this.scanDir(fullPath);
            } else if (entry.isFile() && this.shouldInclude(fullPath)) {
                this.files.push(fullPath);
            }
        }
    }

    getFiles() {
        for (const dir of this.config.includeDirs) {
            const dirPath = path.join(PROJECT_ROOT, dir);
            if (fs.existsSync(dirPath)) {
                this.scanDir(dirPath);
            }
        }
        return this.files;
    }
}

// ============================================
// CLASSE: VariableParser
// ============================================
class VariableParser {
    /**
     * @param {string} content
     * @param {string} filePath
     */
    constructor(content, filePath) {
        this.content = content;
        this.filePath = filePath;
        /** @type {any[]} */
        this.lines = content.split('\n');
        /** @type {any[]} */
        this.variables = [];
        /** @type {any[]} */
        this.functions = [];
        /** @type {any[]} */
        this.classes = [];
        this.exports = new Set();
        this.imports = new Map();
        this.moduleExports = null;
    }

    parse() {
        this.findExports();
        this.findImports();
        this.findModuleExports();
        this.findVariables();
        this.findFunctions();
        this.findClasses();
        return {
            variables: this.variables,
            functions: this.functions,
            classes: this.classes,
            exports: this.exports,
            imports: this.imports,
            moduleExports: this.moduleExports,
        };
    }

    findExports() {
        // export const/let/function/class
        const exportRegex = /^export\s+(const|let|var|function|class)\s+(\w+)/;
        // export { X, Y }
        const exportNamedRegex = /^export\s*\{([^}]+)\}/;

        for (let i = 0; i < this.lines.length; i++) {
            const line = this.lines[i].trim();

            let match = line.match(exportRegex);
            if (match) {
                this.exports.add(match[2] ?? '');
            }

            match = line.match(exportNamedRegex);
            if (match) {
                const names = (match[1] ?? '')
                    .split(',')
                    .map(/** @param {string} n */ (n) => n.trim().split(' as ')[0] ?? '');
                names.forEach(/** @param {string} n */ (n) => this.exports.add(n));
            }
        }
    }

    findImports() {
        // import { X } from '...'
        // import X from '...'
        // import * as X from '...'
        const importRegex = /^import\s+(?:\{([^}]+)\}|(\w+)|(\*\s+as\s+(\w+)))\s+from\s+['"]([^'"]+)['"]/;

        for (let i = 0; i < this.lines.length; i++) {
            const line = this.lines[i].trim();

            const match = line.match(importRegex);
            if (match) {
                if (match[1]) {
                    // named imports
                    const names = match[1].split(',').map(/** @param {string} n */ (n) => n.trim().split(' as ')[0]);
                    names.forEach(
                        /** @param {string} n */ (n) => this.imports.set(n, { line: i + 1, source: match[5] ?? '' }),
                    );
                } else if (match[2]) {
                    // default import
                    this.imports.set(match[2] ?? '', { line: i + 1, source: match[5] ?? '' });
                } else if (match[4]) {
                    // namespace import
                    this.imports.set(match[4] ?? '', { line: i + 1, source: match[5] ?? '', namespace: true });
                }
            }
        }
    }

    findModuleExports() {
        // module.exports = ...
        // exports.X = ...
        const moduleExportsRegex = /^module\.exports\s*=/;
        const exportsRegex = /^exports\.\w+\s*=/;

        for (let i = 0; i < this.lines.length; i++) {
            const line = this.lines[i].trim();
            if (moduleExportsRegex.test(line)) {
                this.moduleExports = { line: i + 1 };
                break;
            }
            if (exportsRegex.test(line)) {
                if (!this.moduleExports) {
                    this.moduleExports = { line: i + 1, properties: [] };
                }
            }
        }
    }

    findVariables() {
        // Padrões de declaração
        const patterns = [
            // const/let/var
            { regex: /^(const|let|var)\s+(\w+)\s*=\s*(.+?);?$/, type: 'declaration' },
            // const/let/var com destructuring
            { regex: /^(const|let|var)\s+\{([^}]+)\}\s*=/, type: 'destructuring-object' },
            { regex: /^(const|let|var)\s+\[([^\]]+)\]\s*=/, type: 'destructuring-array' },
            // class properties no constructor ou métodos
            { regex: /this\.(\w+)\s*=\s*(.+?);?$/, type: 'class-property' },
        ];

        for (let i = 0; i < this.lines.length; i++) {
            const line = this.lines[i];
            const trimmedLine = line.trim();
            const lineNum = i + 1;

            // Ignorar comentários
            if (trimmedLine.startsWith('//') || trimmedLine.startsWith('*') || trimmedLine.startsWith('/*')) {
                continue;
            }

            // Verificar cada padrão
            for (const pattern of patterns) {
                const match = trimmedLine.match(pattern.regex);
                if (match) {
                    const m = /** @type {any} */ (match);
                    if (pattern.type === 'declaration') {
                        const keyword = /** @type {string} */ (m[1]);
                        const name = /** @type {string} */ (m[2]);
                        const value = /** @type {string} */ (m[3]);
                        const varInfo = this.analyzeVariable(name, value.trim(), keyword, lineNum, line);
                        this.variables.push(varInfo);
                    } else if (pattern.type === 'destructuring-object') {
                        const keyword = /** @type {string} */ (m[1]);
                        const props = /** @type {string} */ (m[2]);
                        const propList = props
                            .split(',')
                            .map(/** @param {string} p */ (p) => p.trim().split(':')[0]?.trim() ?? '');
                        propList.forEach(
                            /** @param {string} prop */ (prop) => {
                                if (prop && !prop.includes('...')) {
                                    const varInfo = this.analyzeVariable(prop, 'undefined', keyword, lineNum, line);
                                    this.variables.push(varInfo);
                                }
                            },
                        );
                    } else if (pattern.type === 'destructuring-array') {
                        const keyword = /** @type {string} */ (m[1]);
                        const props = /** @type {string} */ (m[2]);
                        const propList = props.split(',').map(/** @param {string} p */ (p) => p.trim());
                        propList.forEach(
                            /** @param {string} prop */ (prop) => {
                                if (prop && !prop.includes('...')) {
                                    const varInfo = this.analyzeVariable(prop, 'undefined', keyword, lineNum, line);
                                    this.variables.push(varInfo);
                                }
                            },
                        );
                    } else if (pattern.type === 'class-property') {
                        const name = /** @type {string} */ (m[1]);
                        const value = /** @type {string} */ (m[2]);
                        const varInfo = this.analyzeVariable(name, value.trim(), 'this', lineNum, line);
                        this.variables.push(varInfo);
                    }
                }
            }
        }
    }

    /**
     * @param {string} name
     * @param {string} value
     * @param {string} keyword
     * @param {number} lineNum
     * @param {string} fullLine
     * @returns {any}
     */
    analyzeVariable(name, value, keyword, lineNum, fullLine) {
        const isConst = keyword === 'const';
        const isLet = keyword === 'let';
        const isVar = keyword === 'var';
        const isThis = keyword === 'this';

        // Determinar escopo
        let scope = 'local';
        if (isThis) {
            scope = 'class-property';
        } else {
            // Verificar se é no topo do arquivo (global de módulo)
            const isTopLevel = this.isTopLevel(lineNum);
            if (isTopLevel) {
                scope = this.exports.has(name) ? 'global-public' : 'global-private';
            } else {
                scope = 'local';
            }
        }

        // Inferir tipo
        const type = this.inferType(value);

        // Verificar se é constante (valor literal ou tudo maiúsculo)
        const isConstant =
            isConst || (isConst === false && this.isConstantValue(value)) || /^[A-Z][A-Z0-9_]*$/.test(name);

        // Detectar magic values
        const isMagicValue = this.isMagicValue(value);

        return {
            name,
            keyword,
            value: value.substring(0, 100),
            type,
            scope,
            isConst,
            isLet,
            isVar,
            isThis,
            isConstant,
            isMagicValue,
            isExported: this.exports.has(name),
            line: lineNum,
            fullLine: fullLine.trim().substring(0, 150),
            file: this.filePath,
        };
    }

    /**
     * @param {number} lineNum
     * @returns {boolean}
     */
    isTopLevel(lineNum) {
        // Verificar se está no topo do arquivo (antes de qualquer função/classe)
        for (let i = 0; i < lineNum - 1; i++) {
            const line = this.lines[i].trim();
            if (
                line.startsWith('function') ||
                line.startsWith('class') ||
                line.startsWith('const ') ||
                line.startsWith('let ') ||
                line.startsWith('var ') ||
                line.startsWith('export ') ||
                line.startsWith('import ') ||
                line.startsWith('if') ||
                line.startsWith('for') ||
                line.startsWith('while') ||
                line.startsWith('switch')
            ) {
                return false;
            }
        }
        return true;
    }

    /**
     * @param {string} value
     * @returns {string}
     */
    inferType(value) {
        if (!value || value === 'undefined') return 'undefined';
        if (value === 'null') return 'null';
        if (value === 'true' || value === 'false') return 'boolean';
        if (/^-?\d+(\.\d+)?$/.test(value)) return 'number';
        if (/^['"`].*['"`]$/.test(value)) return 'string';
        if (value.startsWith('[') && value.endsWith(']')) return 'array';
        if (value.startsWith('{') && value.endsWith('}')) return 'object';
        if (value.startsWith('function') || value.startsWith('(') || value.startsWith('async')) return 'function';
        if (value.startsWith('/') && value.endsWith('/')) return 'regexp';
        if (value.startsWith('new ') || value.startsWith('class ')) return 'instance';
        return 'unknown';
    }

    /**
     * @param {string} value
     * @returns {boolean}
     */
    isConstantValue(value) {
        // Verificar se o valor parece ser uma constante
        if (!value) return false;
        // Literais numéricos
        if (/^-?\d+(\.\d+)?$/.test(value)) return true;
        // Literais de string
        if (/^['"`].*['"`]$/.test(value)) return true;
        // Arrays de constantes
        if (/^\[.*\]$/.test(value) && !value.includes('...')) return true;
        // Objetos de constantes
        if (/^\{.*\}$/.test(value) && !value.includes('function')) return true;
        // Referências a outras constantes (SCREAMING_SNAKE_CASE)
        if (/^[A-Z][A-Z0-9_]*$/.test(value)) return true;
        return false;
    }

    /**
     * @param {string} value
     * @returns {boolean}
     */
    isMagicValue(value) {
        // Detectar magic numbers e strings
        if (/^-?\d+$/.test(value)) return true; // Números inteiros
        if (/^['"`][a-zA-Z_][a-zA-Z0-9_]*['"`]$/.test(value)) return true; // Strings descritivas
        return false;
    }

    findFunctions() {
        // function name(...)
        const funcRegex = /^(?:async\s+)?function\s+(\w+)\s*\(/;
        // const/let name = function(...) ou arrow functions
        const arrowRegex = /^(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>/;
        // export function
        const exportFuncRegex = /^export\s+(?:async\s+)?function\s+(\w+)\s*\(/;

        for (let i = 0; i < this.lines.length; i++) {
            const line = this.lines[i].trim();
            let match;

            match = line.match(funcRegex);
            if (match) {
                this.functions.push({ name: match[1], line: i + 1, type: 'declaration' });
                continue;
            }

            match = line.match(arrowRegex);
            if (match) {
                this.functions.push({ name: match[1], line: i + 1, type: 'arrow' });
                continue;
            }

            match = line.match(exportFuncRegex);
            if (match) {
                this.functions.push({ name: match[1], line: i + 1, type: 'export' });
            }
        }
    }

    findClasses() {
        // class Name
        const classRegex = /^class\s+(\w+)/;
        // export class Name
        const exportClassRegex = /^export\s+class\s+(\w+)/;

        for (let i = 0; i < this.lines.length; i++) {
            const line = this.lines[i].trim();
            let match;

            match = line.match(exportClassRegex);
            if (match) {
                this.classes.push({ name: match[1], line: i + 1, type: 'export' });
                continue;
            }

            match = line.match(classRegex);
            if (match) {
                this.classes.push({ name: match[1], line: i + 1, type: 'declaration' });
            }
        }
    }
}

// ============================================
// CLASSE: DependencyMapper (reservado para uso futuro)
// ============================================
class _DependencyMapper {
    constructor() {
        this.dependencies = new Map();
    }

    /**
     * @param {any[]} variables
     * @param {string} filePath
     * @returns {any[]}
     */
    analyze(variables, filePath) {
        const fileDeps = [];

        for (const variable of variables) {
            if (variable.scope === 'global-public' || variable.scope === 'global-private') {
                // Identificar dependências no valor
                const deps = this.findDependencies(variable.value, variables);
                if (deps.length > 0) {
                    fileDeps.push({
                        name: variable.name,
                        dependsOn: deps,
                        file: filePath,
                        line: variable.line,
                    });
                }
            }
        }

        return fileDeps;
    }

    /**
     * @param {string} value
     * @param {any[]} allVariables
     * @returns {string[]}
     */
    findDependencies(value, allVariables) {
        /** @type {string[]} */
        const deps = [];
        if (!value) return deps;

        for (const v of allVariables) {
            // Procurar menções a outras variáveis no valor
            const regex = new RegExp(`\\b${v.name}\\b`);
            if (regex.test(value) && v.name !== this.getVariableName(value)) {
                deps.push(v.name);
            }
        }

        return [...new Set(deps)];
    }

    /**
     * @param {string} value
     * @returns {string | null}
     */
    getVariableName(value) {
        // Extrair nome da variável do valor (simplificado)
        const match = value.match(/^(\w+)/);
        return match ? (match[1] ?? null) : null;
    }
}

// ============================================
// CLASSE: IssueDetector
// ============================================
class IssueDetector {
    constructor() {
        /**
         * @type {{
         *     unused: any[];
         *     duplicates: any[];
         *     magicValues: any[];
         *     redundantLet: any[];
         *     enumCandidates: any[];
         *     typeCandidates: any[];
         * }}
         */
        this.issues = {
            unused: [],
            duplicates: [],
            magicValues: [],
            redundantLet: [],
            enumCandidates: [],
            typeCandidates: [],
        };
    }

    /**
     * @param {any[]} allVariables
     * @returns {any}
     */
    detect(allVariables) {
        // 1. Detectar variáveis não utilizadas (simplificado)
        // (Um análise real precisaria de AST completo)

        // 2. Detectar duplicatas por nome
        const nameCount = new Map();
        for (const v of allVariables) {
            const count = nameCount.get(v.name) || 0;
            nameCount.set(v.name, count + 1);
        }

        for (const [name, count] of nameCount) {
            if (count > 1 && !this.isCommonName(name)) {
                this.issues.duplicates.push({
                    name,
                    count,
                    files: allVariables
                        .filter(/** @param {any} v */ (v) => v.name === name)
                        .map(/** @param {any} v */ (v) => v.file),
                });
            }
        }

        // 3. Detectar magic values
        for (const v of allVariables) {
            if (v.isMagicValue && v.scope !== 'local') {
                this.issues.magicValues.push(v);
            }
        }

        // 4. Detectar let que deveria ser const
        for (const v of allVariables) {
            if (v.isLet && v.isConstant) {
                this.issues.redundantLet.push(v);
            }
        }

        // 5. Detectar candidatas a ENUM
        this.detectEnumCandidates(allVariables);

        // 6. Detectar candidatas a TypeScript
        this.detectTypeCandidates(allVariables);

        return this.issues;
    }

    /**
     * @param {string} name
     * @returns {boolean}
     */
    isCommonName(name) {
        const commonNames = [
            'i',
            'j',
            'k',
            'x',
            'y',
            'z',
            'err',
            'e',
            'cb',
            'cb2',
            'done',
            'next',
            'val',
            'key',
            'item',
            'row',
            'col',
            'temp',
            'tmp',
            'data',
            'result',
            'res',
            'options',
            'opts',
            'config',
            'cfg',
            'ctx',
            'context',
            'req',
            'res',
            'app',
        ];
        return commonNames.includes(name);
    }

    /**
     * @param {any[]} variables
     */
    detectEnumCandidates(variables) {
        // Agrupar por valor para encontrar valores comuns
        const valueGroups = new Map();

        for (const v of variables) {
            if (v.type === 'string' && v.value && v.scope !== 'local') {
                const val = v.value.replace(/['"`]/g, '');
                if (!valueGroups.has(val)) {
                    valueGroups.set(val, []);
                }
                valueGroups.get(val).push(v);
            }
        }

        // Valores que aparecem em múltiplos lugares são candidatas a ENUM
        for (const [value, vars] of valueGroups) {
            if (vars.length >= 2 && value.length < 30) {
                this.issues.enumCandidates.push({
                    value,
                    usages: vars.length,
                    variables: vars.map(/** @param {any} v */ (v) => ({ name: v.name, file: v.file, line: v.line })),
                });
            }
        }
    }

    /**
     * @param {any[]} variables
     */
    detectTypeCandidates(variables) {
        // Objetos com estrutura similar são candidatas a interface
        const objectVars = variables.filter((v) => v.type === 'object' && v.value !== '{}');

        // Agrupar por número de propriedades (simplificado)
        const propCountGroups = new Map();
        for (const v of objectVars) {
            const props = (v.value.match(/\w+:/g) || []).length;
            if (props > 0 && props < 20) {
                if (!propCountGroups.has(props)) {
                    propCountGroups.set(props, []);
                }
                propCountGroups.get(props).push(v);
            }
        }

        for (const [props, vars] of propCountGroups) {
            if (vars.length >= 2) {
                this.issues.typeCandidates.push({
                    type: 'object',
                    propertyCount: props,
                    files: vars.map(/** @param {any} v */ (v) => ({ name: v.name, file: v.file })),
                });
            }
        }
    }
}

// ============================================
// CLASSE: ReportGenerator
// ============================================
class ReportGenerator {
    /**
     * @param {any} data
     */
    constructor(data) {
        this.data = data;
    }

    generate() {
        const sections = [
            this.generateHeader(),
            this.generateSummary(),
            this.generateGlobalsPublic(),
            this.generateGlobalsPrivate(),
            this.generateConstants(),
            this.generateIssues(),
            this.generateRecommendations(),
        ];

        return sections.join('\n');
    }

    generateHeader() {
        return `# 📊 Relatório de Análise de Variáveis e Constantes

**Projeto:** chatgpt-docker-puppeteer
**Data:** ${new Date().toISOString().split('T')[0]}
**Versão do Script:** 1.0.0

---
`;
    }

    generateSummary() {
        const { files, globalPublic, globalPrivate, local, constants, issues } = this.data;

        return `## 📈 Sumário Executivo

| Métrica | Valor |
|---------|-------|
| **Arquivos Analisados** | ${files.length} |
| **Variáveis Globais Públicas** | ${globalPublic.length} |
| **Variáveis Globais Privadas** | ${globalPrivate.length} |
| **Variáveis Locais** | ${local.length} |
| **Constantes Identificadas** | ${constants.length} |
| **Problemas Encontrados** | ${issues.unused.length + issues.duplicates.length + issues.magicValues.length} |

### Distribuição por Tipo

${this.generateTypeDistribution()}

---
`;
    }

    generateTypeDistribution() {
        /** @type {Record<string, number>} */
        const types = {};
        const allVars = [...this.data.globalPublic, ...this.data.globalPrivate, ...this.data.local];

        for (const v of allVars) {
            types[v.type] = (types[v.type] || 0) + 1;
        }

        const rows = Object.entries(types)
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => `| ${type} | ${count} |`)
            .join('\n');

        return `| Tipo | Quantidade |\n|------|------------|\n${rows}`;
    }

    generateGlobalsPublic() {
        if (this.data.globalPublic.length === 0) return '';

        let md = `## 🌍 Variáveis Globais Públicas (exportadas)

> Variáveis acessíveis de outros módulos

| Nome | Tipo | Valor Inicial | Escopo | Arquivo | Linha |
|------|------|---------------|--------|---------|-------|\n`;

        for (const v of this.data.globalPublic) {
            const file = path.basename(v.file);
            const value = v.value.length > 50 ? v.value.substring(0, 50) + '...' : v.value;
            md += `| \`${v.name}\` | ${v.type} | \`${value}\` | ${v.scope} | ${file} | ${v.line} |\n`;
        }

        md += '\n---\n';
        return md;
    }

    generateGlobalsPrivate() {
        if (this.data.globalPrivate.length === 0) return '';

        // Agrupar por arquivo
        /** @type {Record<string, any[]>} */
        const byFile = {};
        for (const v of this.data.globalPrivate) {
            const file = path.basename(v.file);
            if (!byFile[file]) byFile[file] = [];
            byFile[file].push(v);
        }

        let md = `## 🔒 Variáveis Globais Privadas

> Variáveis acessíveis apenas no módulo onde foram declaradas

`;

        for (const [file, vars] of Object.entries(byFile)) {
            md += `### ${file}\n\n`;
            md += `| Nome | Tipo | Valor | Linha |\n|------|------|-------|-------|\n`;
            for (const v of vars) {
                const value = v.value.length > 40 ? v.value.substring(0, 40) + '...' : v.value;
                md += `| \`${v.name}\` | ${v.type} | \`${value}\` | ${v.line} |\n`;
            }
            md += '\n';
        }

        md += '\n---\n';
        return md;
    }

    generateConstants() {
        if (this.data.constants.length === 0) return '';

        let md = `## ⚙️ Constantes do Sistema

> Variáveis declaradas com const ou que representam valores fixos

`;

        // Agrupar por prefixo/categoria
        const categories = this.categorizeConstants(this.data.constants);

        for (const [category, constants] of Object.entries(categories)) {
            md += `### ${category}\n\n`;
            md += `| Nome | Valor | Tipo | Arquivo |\n|------|-------|------|---------|\n`;
            for (const c of constants) {
                const file = path.basename(c.file);
                const value = c.value.length > 35 ? c.value.substring(0, 35) + '...' : c.value;
                md += `| \`${c.name}\` | \`${value}\` | ${c.type} | ${file} |\n`;
            }
            md += '\n';
        }

        md += '\n---\n';
        return md;
    }

    /**
     * @param {any[]} constants
     * @returns {Record<string, any[]>}
     */
    categorizeConstants(constants) {
        /** @type {any} */
        const categories = {
            'URLs e Endpoints': [],
            'Timeouts e Números': [],
            'Strings de Texto': [],
            Configurações: [],
            Outros: [],
        };

        for (const c of constants) {
            const value = c.value.toLowerCase();

            if (
                value.includes('http') ||
                value.includes('url') ||
                value.includes('endpoint') ||
                value.includes('://')
            ) {
                categories['URLs e Endpoints'].push(c);
            } else if (
                /^\d+$/.test(value) ||
                value.includes('timeout') ||
                value.includes('delay') ||
                value.includes('port')
            ) {
                categories['Timeouts e Números'].push(c);
            } else if (/^['"`]/.test(c.value)) {
                categories['Strings de Texto'].push(c);
            } else if (value.includes('config') || value.includes('option') || value.includes('env')) {
                categories['Configurações'].push(c);
            } else {
                categories['Outros'].push(c);
            }
        }

        // Remover categorias vazias
        return Object.fromEntries(Object.entries(categories).filter(([_, v]) => v.length > 0));
    }

    generateIssues() {
        let md = `## 🚨 Problemas Identificados

`;

        // Magic Values
        if (this.data.issues.magicValues.length > 0) {
            md += `### ⚠️ Magic Values (Valores Mágicos)

Valores hardcoded que deveriam ser constantes nomeadas:

| Variável | Valor | Arquivo | Linha |
|----------|-------|---------|-------|\n`;

            for (const v of this.data.issues.magicValues.slice(0, 20)) {
                const file = path.basename(v.file);
                md += `| \`${v.name}\` | \`${v.value}\` | ${file} | ${v.line} |\n`;
            }
            if (this.data.issues.magicValues.length > 20) {
                md += `\n*...e mais ${this.data.issues.magicValues.length - 20} valores mágicos*\n`;
            }
            md += '\n';
        }

        // Duplicates
        if (this.data.issues.duplicates.length > 0) {
            md += `### 🔄 Variáveis Duplicadas

Nomes usados em múltiplos lugares:

| Nome | Ocorrências | Arquivos |
|------|-------------|----------|\n`;

            for (const d of this.data.issues.duplicates.slice(0, 15)) {
                const files = [...new Set(d.files.map(/** @param {any} f */ (f) => path.basename(f)))]
                    .slice(0, 3)
                    .join(', ');
                md += `| \`${d.name}\` | ${d.count} | ${files} |\n`;
            }
            md += '\n';
        }

        // Redundant Let
        if (this.data.issues.redundantLet.length > 0) {
            md += `### 📝 let que deveria ser const

Variáveis declaradas com let mas que nunca são modificadas:

| Variável | Valor | Arquivo | Linha |
|----------|-------|---------|-------|\n`;

            for (const v of this.data.issues.redundantLet.slice(0, 15)) {
                const file = path.basename(v.file);
                md += `| \`${v.name}\` | \`${v.value}\` | ${file} | ${v.line} |\n`;
            }
            md += '\n';
        }

        md += '\n---\n';
        return md;
    }

    generateRecommendations() {
        let md = `## 💡 Recomendações de Refatoração

### 1. Criar ENUMs

Os seguintes valores são usados em múltiplos lugares e devem ser transformados em ENUMs:

`;

        if (this.data.issues.enumCandidates.length > 0) {
            for (const candidate of this.data.issues.enumCandidates.slice(0, 10)) {
                md += `**"${candidate.value}"** - usado ${candidate.usages} vezes:\n`;
                md += '```javascript\n';
                md += `const ${this.toPascalCase(candidate.value).toUpperCase()} = '${candidate.value}';\n`;
                md += `// ou\n`;
                md += `enum ${this.toPascalCase(candidate.value)} {\n`;
                md += `  ${candidate.value.toUpperCase().replace(/[^A-Z0-9]/g, '_')} = '${candidate.value}'\n`;
                md += `}\n`;
                md += '```\n\n';
            }
        } else {
            md += '*Nenhum candidato a ENUM encontrado*\n';
        }

        md += `
### 2. Extrair Magic Values

Valores hardcoded devem ser movidos para um arquivo de constantes:

\`\`\`javascript
// Antes
if (status === 1) { ... }

// Depois
const TaskStatus = { ACTIVE: 1, COMPLETED: 2, FAILED: 3 };
if (status === TaskStatus.ACTIVE) { ... }
\`\`\`

### 3. Converter let para const

Variáveis que não são reatribuídas devem usar \`const\`:
- Melhora legibilidade
- Permite otimizações do motor JS
- Evita reassign acidental

### 4. Considerar TypeScript

Os seguintes padrões foram identificados:

- Objetos com estrutura fixa → \`interface\`
- Funções com tipos específicos → \`type annotations\`
- Variáveis que aceitam múltiplos tipos → \`union types\`

### 5. Boas Práticas de Nomenclatura

| Tipo | Padrão | Exemplo |
|------|--------|---------|
| Constantes | SCREAMING_SNAKE_CASE | \`MAX_RETRIES\` |
| Variáveis | camelCase | \`userName\` |
| Classes | PascalCase | \`TaskManager\` |
| Booleanos | Prefixo is/has/can | \`isEnabled\` |
| Funções | Verb + Noun | \`getUsers()\` |

---
`;

        return md;
    }

    /**
     * @param {string} str
     * @returns {string}
     */
    toPascalCase(str) {
        return str
            .replace(/[^a-zA-Z0-9]+(.)/g, /** @param {string} _ @param {string} chr */ (_, chr) => chr.toUpperCase())
            .replace(/^./, /** @param {string} chr */ (chr) => chr.toUpperCase());
    }
}

// ============================================
// FUNÇÃO PRINCIPAL
// ============================================
async function main() {
    console.log('🔍 Iniciando análise de variáveis e constantes...\n');

    // 1. Escanear arquivos
    console.log('📁 Escaneando arquivos...');
    const scanner = new FileScanner(CONFIG);
    const files = scanner.getFiles();
    console.log(`   Encontrados ${files.length} arquivos para análise`);

    // 2. Parsear cada arquivo
    console.log('\n📝 Parseando arquivos e identificando variáveis...');
    /** @type {any[]} */
    const allVariables = [];
    /** @type {any[]} */
    const allFunctions = [];
    /** @type {any[]} */
    const allClasses = [];

    for (const file of files) {
        try {
            const content = fs.readFileSync(file, 'utf-8');
            const parser = new VariableParser(content, file);
            const result = parser.parse();

            allVariables.push(...result.variables);
            allFunctions.push(...result.functions);
            allClasses.push(...result.classes);

            analysisData.files.push(file);
        } catch (err) {
            const _e = /** @type {any} */ (err);
            console.warn(`   ⚠️  Erro ao processar ${file}: ${_e.message}`);
        }
    }

    console.log(`   Total de variáveis encontradas: ${allVariables.length}`);
    console.log(`   Total de funções encontradas: ${allFunctions.length}`);
    console.log(`   Total de classes encontradas: ${allClasses.length}`);

    // 3. Categorizar variáveis
    console.log('\n📊 Categorizando variáveis por escopo...');

    for (const v of allVariables) {
        if (v.scope === 'global-public') {
            analysisData.globalPublic.push(v);
            if (v.isConst || v.isConstant) {
                analysisData.constants.push(v);
            }
        } else if (v.scope === 'global-private') {
            analysisData.globalPrivate.push(v);
            if (v.isConst || v.isConstant) {
                analysisData.constants.push(v);
            }
        } else {
            analysisData.local.push(v);
        }
    }

    console.log(`   Globais públicas: ${analysisData.globalPublic.length}`);
    console.log(`   Globais privadas: ${analysisData.globalPrivate.length}`);
    console.log(`   Locais: ${analysisData.local.length}`);

    // 4. Detectar problemas
    console.log('\n🔍 Detectando problemas...');
    const detector = new IssueDetector();
    analysisData.issues = detector.detect(allVariables);

    console.log(`   Magic values: ${analysisData.issues.magicValues.length}`);
    console.log(`   Duplicatas: ${analysisData.issues.duplicates.length}`);
    console.log(`   let → const: ${analysisData.issues.redundantLet.length}`);
    console.log(`   Candidatos ENUM: ${analysisData.issues.enumCandidates.length}`);

    // 5. Gerar relatório
    console.log('\n📄 Gerando relatório...');
    const generator = new ReportGenerator(analysisData);
    const report = generator.generate();

    // 6. Salvar relatório
    const reportPath = path.join(PROJECT_ROOT, 'VARIABLE_ANALYSIS_REPORT.md');
    fs.writeFileSync(reportPath, report, 'utf-8');

    console.log(`\n✅ Relatório salvo em: ${reportPath}`);
    console.log('\n📊 Resumo Final:');
    console.log(`   - Arquivos analisados: ${analysisData.files.length}`);
    console.log(`   - Variáveis globais públicas: ${analysisData.globalPublic.length}`);
    console.log(`   - Variáveis globais privadas: ${analysisData.globalPrivate.length}`);
    console.log(`   - Variáveis locais: ${analysisData.local.length}`);
    console.log(
        `   - Total de problemas: ${analysisData.issues.magicValues.length + analysisData.issues.duplicates.length + analysisData.issues.redundantLet.length}`,
    );
}

// Executar
main().catch(console.error);
