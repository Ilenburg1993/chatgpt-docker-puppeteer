import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

test('wave17: mission transitions usam serviço único (sem updateMission(status) em controller/runner)', async () => {
    const missionController = await fs.readFile(
        path.join(process.cwd(), 'src/server/api/controllers/missions.js'),
        'utf8'
    );
    const missionRunner = await fs.readFile(path.join(process.cwd(), 'src/agent/mission_runner.js'), 'utf8');

    const statusMutationPattern = /updateMission\s*\([^)]*$/gm;
    const hasStatusMutation = content => {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i += 1) {
            if (!statusMutationPattern.test(lines[i])) {
                statusMutationPattern.lastIndex = 0;
                continue;
            }
            statusMutationPattern.lastIndex = 0;
            const window = lines.slice(i, Math.min(i + 12, lines.length)).join('\n');
            if (/status\s*:/.test(window)) {
                return true;
            }
        }
        return false;
    };

    assert.equal(hasStatusMutation(missionController), false);
    assert.equal(hasStatusMutation(missionRunner), false);

    assert.match(missionController, /executeCommand|_runMissionControlCommand/);
    assert.match(missionRunner, /updateMissionProgressState|failMissionTransition|completeMissionTransition/);
});
