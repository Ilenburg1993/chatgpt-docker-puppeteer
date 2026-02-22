import fs from 'fs';
const content = fs.readFileSync('src/main.js', 'utf8');
let parens = 0;
let braces = 0;
let brackets = 0;
let lineNum = 1;
let charInLine = 0;
for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char === '\n') {
        lineNum++;
        charInLine = 0;
    } else {
        charInLine++;
    }

    switch (char) {
        case '(':
            parens++;
            break;
        case ')':
            parens--;
            break;
        case '{':
            braces++;
            break;
        case '}':
            braces--;
            break;
        case '[':
            brackets++;
            break;
        case ']':
            brackets--;
            break;
    }
    if (parens < 0 || braces < 0 || brackets < 0) {
        console.log(`Unmatched at line ${lineNum}, char ${charInLine}, position ${i}: '${char}'`);
        console.log(`Context: ...${content.substring(Math.max(0, i - 30), i + 30)}...`);
        process.exit(1);
    }
}
console.log(`Final counts - Parens: ${parens}, Braces: ${braces}, Brackets: ${brackets}`);
