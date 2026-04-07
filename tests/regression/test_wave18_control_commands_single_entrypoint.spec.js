// @ts-check
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

test('wave18: control plane expõe endpoint único e controllers delegam para executeCommand', async () => {
    const routerContent = await fs.readFile(path.join(process.cwd(), 'src/server/api/router.js'), 'utf8');
    const missionsContent = await fs.readFile(
        path.join(process.cwd(), 'src/server/api/controllers/missions.js'),
        'utf8',
    );
    const tasksContent = await fs.readFile(path.join(process.cwd(), 'src/server/api/controllers/tasks.js'), 'utf8');
    const controlContent = await fs.readFile(path.join(process.cwd(), 'src/server/api/controllers/control.js'), 'utf8');

    assert.match(routerContent, /app\.use\('\/api\/control'/);
    assert.match(controlContent, /(?:router|typedRouter)\.post\(\s*'\/commands'/s);
    assert.match(missionsContent, /executeCommand/);
    assert.match(tasksContent, /executeCommand/);
});
