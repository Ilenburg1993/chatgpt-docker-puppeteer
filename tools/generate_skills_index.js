#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'skills');
const INDEX_FILE = path.join(SKILLS_DIR, 'index.json');

function findSkillDirs(bases) {
    const found = [];
    for (const base of bases) {
        const full = path.resolve(ROOT, base);
        if (!fs.existsSync(full)) continue;
        const entries = fs.readdirSync(full, { withFileTypes: true });
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            const skillDir = path.join(full, e.name);
            const skillMd = path.join(skillDir, 'SKILL.md');
            if (fs.existsSync(skillMd)) {
                found.push({ dir: skillDir, md: skillMd, source: base });
            }
        }
    }
    return found;
}

const candidates = findSkillDirs(['skills/personal', 'skills/project', '.github/skills', '.claude/skills', 'skills']);

const skills = candidates.map(c => {
    const contents = fs.readFileSync(c.md, 'utf8');
    const match = contents.match(/^---\n([\s\S]*?)\n---/);
    let meta = {};
    if (match) {
        try {
            meta = yaml.load(match[1]) || {};
        } catch (e) {
            console.error('YAML parse error in', c.md, e.message || e);
        }
    }
    return {
        name: meta.name || path.basename(c.dir),
        description: meta.description || '',
        license: meta.license || '',
        path: path.relative(ROOT, c.dir),
        source: c.source,
    };
});

if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true });
fs.writeFileSync(INDEX_FILE, JSON.stringify(skills, null, 2));
console.log(`Wrote ${skills.length} skills to ${path.relative(ROOT, INDEX_FILE)}`);

// Update skills/README.md with a simple list
const readmePath = path.join(SKILLS_DIR, 'README.md');
const header = '# Skills index\n\nThis directory holds collected skills.\n\n';
let list = skills.map(s => `- **${s.name}**: ${s.description} ([${s.path}](./${s.path}/SKILL.md))`).join('\n');
if (!list) list = '_No skills found._';
fs.writeFileSync(readmePath, header + list + '\n');
console.log(`Updated ${path.relative(ROOT, readmePath)}`);
