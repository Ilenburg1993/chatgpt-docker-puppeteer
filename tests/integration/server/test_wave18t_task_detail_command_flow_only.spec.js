import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

test('wave18t: TaskDetail usa stores command-first para mutação', async () => {
    const taskDetail = await fs.readFile(path.join(process.cwd(), 'src/dashboard-ui/src/views/TaskDetail.vue'), 'utf8');

    assert.match(taskDetail, /tasksStore\.patchTask/);
    assert.match(taskDetail, /tasksStore\.setDependencies/);
    assert.match(taskDetail, /tasksStore\.taskAction/);
    assert.match(taskDetail, /tasksStore\.reassignTaskMission/);
    assert.doesNotMatch(taskDetail, /http\.(post|patch|put)\(\s*['"`]\/api\/tasks/);
});
