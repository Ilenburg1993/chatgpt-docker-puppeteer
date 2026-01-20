/**
 * Codemod: Replace connection mode magic strings with constants
 *
 * Transforms:
 *   'hybrid' → CONNECTION_MODES.HYBRID
 *   'local' → CONNECTION_MODES.LOCAL
 *   etc.
 *
 * Usage:
 *   npx jscodeshift -t scripts/codemods/transform-connection-modes.js src/path/to/file.js
 */

const path = require('path');

function getImportPath(filePath, targetPath) {
    const relativePath = path.relative(path.dirname(filePath), targetPath);
    const normalizedPath = relativePath.replace(/\\/g, '/');
    return normalizedPath.startsWith('.') ? normalizedPath : `./${normalizedPath}`;
}

module.exports = function (fileInfo, api) {
    const j = api.jscodeshift;
    const root = j(fileInfo.source);
    const constantsPath = path.join(process.cwd(), 'src/core/constants/browser.js');
    const importPath = getImportPath(fileInfo.path, constantsPath);

    // Connection modes mapping (lowercase string → UPPERCASE constant)
    const CONNECTION_MODES_MAP = {
        hybrid: 'HYBRID',
        local: 'LOCAL',
        auto: 'AUTO',
        launcher: 'LAUNCHER',
        remote: 'REMOTE',
        singularity: 'SINGULARITY'
    };

    let hasChanges = false;
    let needsImport = false;

    // Replace string literals
    Object.entries(CONNECTION_MODES_MAP).forEach(([literal, constant]) => {
        root.find(j.Literal, { value: literal }).forEach(path => {
            // Skip if in object key position
            const parent = path.parent;
            if (parent.value.type === 'Property' && parent.value.key === path.value) {
                return;
            }

            // Skip if it's part of a path or URL
            const grandparent = path.parent.parent;
            if (grandparent && grandparent.value.type === 'CallExpression') {
                const callee = grandparent.value.callee;
                if (
                    (callee.type === 'MemberExpression' && callee.object.name === 'path') ||
                    callee.name === 'require'
                ) {
                    return;
                }
            }

            // Replace with member expression
            j(path).replaceWith(j.memberExpression(j.identifier('CONNECTION_MODES'), j.identifier(constant)));
            hasChanges = true;
            needsImport = true;
        });
    });

    if (!hasChanges) {
        return null;
    }

    // Check if import already exists
    const hasImport =
        root
            .find(j.VariableDeclarator, {
                id: { type: 'ObjectPattern' },
                init: {
                    callee: { name: 'require' },
                    arguments: [{ value: importPath }]
                }
            })
            .size() > 0;

    // Add import if needed
    if (needsImport && !hasImport) {
        const importStatement = j.variableDeclaration('const', [
            j.variableDeclarator(
                j.objectPattern([
                    j.property('init', j.identifier('CONNECTION_MODES'), j.identifier('CONNECTION_MODES'))
                ]),
                j.callExpression(j.identifier('require'), [j.literal(importPath)])
            )
        ]);

        const firstRequire = root
            .find(j.VariableDeclaration, {
                declarations: [
                    {
                        init: { callee: { name: 'require' } }
                    }
                ]
            })
            .at(0);

        if (firstRequire.size() > 0) {
            firstRequire.get().insertAfter(importStatement);
        } else {
            root.get().node.program.body.unshift(importStatement);
        }
    }

    return root.toSource({ quote: 'single', trailingComma: false });
};
