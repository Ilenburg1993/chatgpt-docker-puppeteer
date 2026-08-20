import fs from 'fs';
const content = fs.readFileSync('src/main.js', 'utf8');
const lines = content.split('\n');
console.log(`Total lines: ${lines.length}`);
console.log(`Line 124: ${lines[123]}`);
const inspectedLine = lines[123] ?? '';
console.log(`Line 124 length: ${inspectedLine.length}`);
console.log(`Line 124 chars: ${Array.from(inspectedLine).map((c) => c.charCodeAt(0))}`);
