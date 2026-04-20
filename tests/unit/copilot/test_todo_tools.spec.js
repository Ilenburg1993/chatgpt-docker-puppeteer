// @ts-check
/**
 * tests/unit/copilot/test_todo_tools.spec.js
 *
 * Testes unitários para src/copilot/tools/todo-tools.js (Fase 8 — Deep Todo Tool).
 *
 * Cobertura:
 *
 * - Exportações do módulo: todoTools, todoReadTools, todoWriteTools
 * - allTools em index.js inclui todoTools
 * - skipPermission: read=true, write=false
 * - todo_create: campos obrigatórios, campos opcionais, criação de subtarefa via parent_id
 * - todo_get: tarefa existente, tarefa inexistente, include_subtasks
 * - todo_list: sem filtros, por status, por prioridade, por tag, por texto, parent_id null/string
 * - todo_update: patch parcial, add/remove tags, append_notes, metadata merge
 * - todo_set_status: transição válida, transição inválida, force, done→completedAt
 * - todo_delete: exclusão simples, cascade, desvinculação de subtarefas, remoção de referência no pai
 * - todo_add_subtask: criação vinculada ao pai, pai inexistente
 * - todo_search: match múltiplos termos (AND), sem resultado, filtro de status pós-busca
 * - todo_stats: totais, by_status, by_priority, overdue, completion_rate, top_tags
 * - todo_bulk_update: múltiplos IDs, ID inexistente, validação de campos
 * - todo_clear_completed: done+cancelled, dry_run, filter=done only
 * - todo_import: array de tarefas, prioridade padrão, IDs gerados
 * - Persistência: writeStore → readStore roundtrip
 * - Isolamento: cada teste usa diretório temporário separado
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import * as url from 'node:url';
import { describe, it, beforeEach, afterEach } from 'vitest';
import { getCopilotDb } from '../../../src/copilot/db/sqlite.js';

// ─────────────────────────────────────────────────────────────────────────────
// Setup: paths e helpers SQLite
// ─────────────────────────────────────────────────────────────────────────────

const WORKSPACE_ROOT = path.resolve(url.fileURLToPath(new URL('../../../', import.meta.url)));
const TMP_BASE = path.join(WORKSPACE_ROOT, 'tests', 'tmp', 'todo-tools-test');
const TMP_STATE = path.join(TMP_BASE, '.github', 'hooks', 'state');
const TMP_TODOS = path.join(TMP_STATE, 'todos.json');

/**
 * Escreve o store diretamente no arquivo temporário (backup/restore para migração one-shot).
 *
 * @param {Record<string, any>} data
 */
function writeRaw(data) {
    fs.mkdirSync(TMP_STATE, { recursive: true });
    fs.writeFileSync(TMP_TODOS, JSON.stringify({ version: 1, tasks: data }, null, 2), 'utf8');
}

/**
 * Lê tarefas diretamente do SQLite (verifica persistência).
 *
 * @returns {{ version: number; tasks: Record<string, any> }}
 */
function readRaw() {
    try {
        const db = getCopilotDb();
        const rows = /** @type {{ id: string; data: string }[]} */ (
            db.prepare('SELECT id, data FROM copilot_todo_tasks').all()
        );
        /** @type {Record<string, any>} */
        const tasks = {};
        for (const row of rows) tasks[row.id] = JSON.parse(row.data);
        return { version: 1, tasks };
    } catch {
        return { version: 1, tasks: {} };
    }
}

/**
 * Limpa a tabela copilot_todo_tasks para isolamento entre testes.
 */
function clearTodoTable() {
    try {
        getCopilotDb().prepare('DELETE FROM copilot_todo_tasks').run();
    } catch {
        // tabela pode não existir — ignorar
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Import após setup de paths (lazy import via dynamic para isolamento)
// ─────────────────────────────────────────────────────────────────────────────

// Import estático (o módulo lê TODOS_FILE no handler, não no import)
import { allTools } from '../../../src/copilot/tools/index.js';
import { todoReadTools, todoTools, todoWriteTools } from '../../../src/copilot/tools/todo/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Invoca o handler de uma tool com os parâmetros fornecidos.
 *
 * @param {import('@github/copilot-sdk').Tool<any>} tool
 * @param {Record<string, any>} params
 * @returns {Promise<any>}
 */
async function call(tool, params) {
    return /** @type {any} */ (tool).handler(params);
}

/**
 * Retorna a tool pelo nome do array todoTools.
 *
 * @param {string} name
 * @returns {import('@github/copilot-sdk').Tool<any>}
 */
function getTool(name) {
    const t = todoTools.find((t) => /** @type {any} */ (t).name === name);
    assert.ok(t, `Tool não encontrada: ${name}`);
    return t;
}

/**
 * Redirecionamento do caminho de persistência para o diretório temporário de teste. O módulo usa URL relativa ao
 * import.meta.url, então precisamos patch no nível do arquivo. Alternativa: injetar override via mock de fs. Usamos a
 * abordagem de pré-criar o diretório e o arquivo no TMP_STATE, mas o módulo ainda escreve no caminho real.
 *
 * Para contornar isso sem ejetar o módulo, adicionamos uma variável de ambiente que o módulo poderá ler. Como o módulo
 * não usa env, usamos a abordagem de symlink temporário.
 *
 * Nota: Para testes mais simples, testamos o comportamento via efeitos observados (criação do arquivo, conteúdo, etc.)
 * sem redirecionar o caminho — testando o módulo real.
 */

// Path real do arquivo de dados (onde o módulo persiste)
const REAL_STATE_DIR = path.join(WORKSPACE_ROOT, '.github', 'hooks', 'state');
const REAL_TODOS = path.join(REAL_STATE_DIR, 'todos.json');
const REAL_TODOS_BAK = REAL_TODOS + '.test-backup';

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle: backup e restore do arquivo real
// ─────────────────────────────────────────────────────────────────────────────

/** @type {string | null} */
let originalContent = null;

beforeEach(() => {
    // Garantir que o diretório existe (para compatibilidade com migração one-shot)
    fs.mkdirSync(REAL_STATE_DIR, { recursive: true });
    // Backup do arquivo JSON legado (se houver)
    if (fs.existsSync(REAL_TODOS)) {
        originalContent = fs.readFileSync(REAL_TODOS, 'utf8');
    } else {
        originalContent = null;
    }
    // Limpar tabela SQLite para cada teste (isolamento F4.2)
    clearTodoTable();
    // Garantir que o JSON legado não interfira com a migração
    if (fs.existsSync(REAL_TODOS)) {
        fs.unlinkSync(REAL_TODOS);
    }
});

afterEach(() => {
    // Limpar tabela SQLite
    clearTodoTable();
    // Restaurar o arquivo JSON legado original
    if (originalContent !== null) {
        fs.writeFileSync(REAL_TODOS, originalContent, 'utf8');
    } else if (fs.existsSync(REAL_TODOS)) {
        fs.unlinkSync(REAL_TODOS);
    }
    // Limpar tmp também
    try {
        fs.rmSync(TMP_BASE, { recursive: true, force: true });
    } catch {
        // ignorar erros de limpeza
    }
});

/**
 * Lê o store via SQLite (onde o módulo persiste dados durante os testes).
 *
 * @returns {{ version: number; tasks: Record<string, any> }}
 */
function readStore() {
    return readRaw();
}

// ─────────────────────────────────────────────────────────────────────────────
// Testes de exportações e integração
// ─────────────────────────────────────────────────────────────────────────────

describe('todoTools — exportações e integração', () => {
    it('exporta todoTools com 12 tools', () => {
        assert.equal(todoTools.length, 12);
    });

    it('exporta todoReadTools com 4 tools', () => {
        assert.equal(todoReadTools.length, 4);
    });

    it('exporta todoWriteTools com 8 tools', () => {
        assert.equal(todoWriteTools.length, 8);
    });

    it('todos os nomes de tool começam com todo_', () => {
        for (const tool of todoTools) {
            assert.ok(
                /** @type {any} */ (tool).name.startsWith('todo_'),
                `Nome inválido: ${/** @type {any} */ (tool).name}`,
            );
        }
    });

    it('tools de leitura têm skipPermission: true', () => {
        for (const tool of todoReadTools) {
            assert.equal(
                /** @type {any} */ (tool).skipPermission,
                true,
                `${/** @type {any} */ (tool).name} deveria ter skipPermission=true`,
            );
        }
    });

    it('tools de escrita NÃO têm skipPermission', () => {
        for (const tool of todoWriteTools) {
            const skip = /** @type {any} */ (tool).skipPermission;
            assert.ok(!skip, `${/** @type {any} */ (tool).name} não deveria ter skipPermission=true`);
        }
    });

    it('allTools inclui as 12 todoTools', () => {
        const todoNames = todoTools.map((t) => /** @type {any} */ (t).name);
        const allNames = allTools.map((t) => /** @type {any} */ (t).name);
        for (const name of todoNames) {
            assert.ok(allNames.includes(name), `allTools não contém: ${name}`);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// todo_create
// ─────────────────────────────────────────────────────────────────────────────

describe('todo_create', () => {
    it('cria tarefa com campos mínimos', async () => {
        const res = await call(getTool('todo_create'), { title: 'Tarefa mínima' });
        assert.equal(res.success, true);
        assert.ok(res.task.id);
        assert.equal(res.task.title, 'Tarefa mínima');
        assert.equal(res.task.status, 'todo');
        assert.equal(res.task.priority, 'medium');
        assert.deepEqual(res.task.tags, []);
        assert.equal(res.task.parentId, null);
        assert.equal(res.task.completedAt, null);
    });

    it('cria tarefa com todos os campos', async () => {
        const res = await call(getTool('todo_create'), {
            title: 'Tarefa completa',
            description: 'Desc detalhada',
            priority: 'critical',
            tags: ['backend', 'urgent'],
            due_date: '2030-12-31T23:59:59Z',
            notes: 'Notas importantes',
            metadata: { sprint: 8, estimate: 3 },
        });
        assert.equal(res.success, true);
        assert.equal(res.task.priority, 'critical');
        assert.deepEqual(res.task.tags, ['backend', 'urgent']);
        assert.equal(res.task.dueDate, '2030-12-31T23:59:59Z');
        assert.equal(res.task.notes, 'Notas importantes');
        assert.equal(res.task.metadata.sprint, 8);
    });

    it('cria subtarefa com parent_id válido', async () => {
        const parent = await call(getTool('todo_create'), { title: 'Pai' });
        const child = await call(getTool('todo_create'), {
            title: 'Filho',
            parent_id: parent.task.id,
        });
        assert.equal(child.success, true);
        assert.equal(child.task.parentId, parent.task.id);

        // Verificar que pai foi atualizado
        const store = readStore();
        const parentTask = store.tasks[parent.task.id];
        assert.ok(parentTask.subtaskIds.includes(child.task.id));
    });

    it('falha com parent_id inexistente', async () => {
        const res = await call(getTool('todo_create'), {
            title: 'Orfã',
            parent_id: 'nonexistent123',
        });
        assert.equal(res.success, false);
        assert.ok(res.error.includes('pai não encontrada'));
    });

    it('persiste no disco após criação', async () => {
        await call(getTool('todo_create'), { title: 'Persistida' });
        const store = readStore();
        const ids = Object.keys(store.tasks);
        assert.equal(ids.length, 1);
        assert.equal(store.tasks[/** @type {string} */ (ids[0])].title, 'Persistida');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// todo_get
// ─────────────────────────────────────────────────────────────────────────────

describe('todo_get', () => {
    it('retorna tarefa existente', async () => {
        const created = await call(getTool('todo_create'), { title: 'Para buscar' });
        const res = await call(getTool('todo_get'), { id: created.task.id });
        assert.equal(res.success, true);
        assert.equal(res.task.title, 'Para buscar');
    });

    it('retorna erro para ID inexistente', async () => {
        const res = await call(getTool('todo_get'), { id: 'nope123' });
        assert.equal(res.success, false);
        assert.ok(res.error.includes('não encontrada'));
    });

    it('inclui overdue: false para tarefa sem dueDate', async () => {
        const created = await call(getTool('todo_create'), { title: 'Sem vencimento' });
        const res = await call(getTool('todo_get'), { id: created.task.id });
        assert.equal(res.task.overdue, false);
    });

    it('inclui overdue: true para tarefa vencida', async () => {
        const created = await call(getTool('todo_create'), {
            title: 'Atrasada',
            due_date: '2020-01-01T00:00:00Z',
        });
        const res = await call(getTool('todo_get'), { id: created.task.id });
        assert.equal(res.task.overdue, true);
    });

    it('inclui subtarefas quando include_subtasks=true', async () => {
        const parent = await call(getTool('todo_create'), { title: 'Pai' });
        await call(getTool('todo_add_subtask'), { parent_id: parent.task.id, title: 'Filho 1' });
        await call(getTool('todo_add_subtask'), { parent_id: parent.task.id, title: 'Filho 2' });

        const res = await call(getTool('todo_get'), { id: parent.task.id, include_subtasks: true });
        assert.equal(res.success, true);
        assert.equal(res.task.subtasks.length, 2);
    });

    it('exclui subtarefas quando include_subtasks=false', async () => {
        const parent = await call(getTool('todo_create'), { title: 'Pai' });
        await call(getTool('todo_add_subtask'), { parent_id: parent.task.id, title: 'Filho' });

        const res = await call(getTool('todo_get'), { id: parent.task.id, include_subtasks: false });
        assert.equal(res.task.subtasks, undefined);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// todo_list
// ─────────────────────────────────────────────────────────────────────────────

describe('todo_list', () => {
    it('lista todas as tarefas sem filtros', async () => {
        await call(getTool('todo_create'), { title: 'T1' });
        await call(getTool('todo_create'), { title: 'T2' });
        await call(getTool('todo_create'), { title: 'T3' });

        const res = await call(getTool('todo_list'), {});
        assert.equal(res.success, true);
        assert.equal(res.total, 3);
        assert.equal(res.returned, 3);
    });

    it('filtra por status', async () => {
        await call(getTool('todo_create'), { title: 'Todo' });
        const t2 = await call(getTool('todo_create'), { title: 'Em progresso' });
        await call(getTool('todo_set_status'), { id: t2.task.id, status: 'in_progress' });

        const res = await call(getTool('todo_list'), { status: 'in_progress' });
        assert.equal(res.total, 1);
        assert.equal(res.tasks[0].title, 'Em progresso');
    });

    it('filtra por prioridade', async () => {
        await call(getTool('todo_create'), { title: 'Crítica', priority: 'critical' });
        await call(getTool('todo_create'), { title: 'Baixa', priority: 'low' });

        const res = await call(getTool('todo_list'), { priority: 'critical' });
        assert.equal(res.total, 1);
        assert.equal(res.tasks[0].priority, 'critical');
    });

    it('filtra por tag', async () => {
        await call(getTool('todo_create'), { title: 'Com tag', tags: ['backend', 'api'] });
        await call(getTool('todo_create'), { title: 'Sem tag' });

        const res = await call(getTool('todo_list'), { tag: 'api' });
        assert.equal(res.total, 1);
        assert.equal(res.tasks[0].title, 'Com tag');
    });

    it('filtra por texto no título', async () => {
        await call(getTool('todo_create'), { title: 'Implementar feature X' });
        await call(getTool('todo_create'), { title: 'Corrigir bug Y' });

        const res = await call(getTool('todo_list'), { text: 'feature' });
        assert.equal(res.total, 1);
        assert.ok(res.tasks[0].title.includes('feature'));
    });

    it('filtra apenas tarefas raiz com parent_id=null', async () => {
        const parent = await call(getTool('todo_create'), { title: 'Raiz' });
        await call(getTool('todo_add_subtask'), { parent_id: parent.task.id, title: 'Sub' });

        const res = await call(getTool('todo_list'), { parent_id: null });
        assert.equal(res.total, 1);
        assert.equal(res.tasks[0].title, 'Raiz');
    });

    it('filtra subtarefas de um pai específico', async () => {
        const parent = await call(getTool('todo_create'), { title: 'Pai' });
        await call(getTool('todo_add_subtask'), { parent_id: parent.task.id, title: 'Sub1' });
        await call(getTool('todo_add_subtask'), { parent_id: parent.task.id, title: 'Sub2' });

        const res = await call(getTool('todo_list'), { parent_id: parent.task.id });
        assert.equal(res.total, 2);
    });

    it('respeita limit', async () => {
        for (let i = 0; i < 10; i++) {
            await call(getTool('todo_create'), { title: `T${i}` });
        }
        const res = await call(getTool('todo_list'), { limit: 3 });
        assert.equal(res.returned, 3);
        assert.equal(res.total, 10);
        assert.equal(res.has_more, true);
    });

    it('retorna lista vazia quando não há tarefas', async () => {
        const res = await call(getTool('todo_list'), {});
        assert.equal(res.total, 0);
        assert.deepEqual(res.tasks, []);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// todo_update
// ─────────────────────────────────────────────────────────────────────────────

describe('todo_update', () => {
    it('atualiza título', async () => {
        const created = await call(getTool('todo_create'), { title: 'Original' });
        const res = await call(getTool('todo_update'), {
            id: created.task.id,
            title: 'Atualizado',
        });
        assert.equal(res.success, true);
        assert.equal(res.task.title, 'Atualizado');
        assert.equal(res.previous.title, 'Original');
    });

    it('atualiza prioridade', async () => {
        const created = await call(getTool('todo_create'), { title: 'T' });
        const res = await call(getTool('todo_update'), { id: created.task.id, priority: 'critical' });
        assert.equal(res.task.priority, 'critical');
    });

    it('substitui tags com tags', async () => {
        const created = await call(getTool('todo_create'), { title: 'T', tags: ['a', 'b'] });
        const res = await call(getTool('todo_update'), { id: created.task.id, tags: ['c', 'd'] });
        assert.deepEqual(res.task.tags, ['c', 'd']);
    });

    it('adiciona tags com add_tags', async () => {
        const created = await call(getTool('todo_create'), { title: 'T', tags: ['a'] });
        const res = await call(getTool('todo_update'), { id: created.task.id, add_tags: ['b', 'c'] });
        assert.ok(res.task.tags.includes('a'));
        assert.ok(res.task.tags.includes('b'));
        assert.ok(res.task.tags.includes('c'));
    });

    it('remove tags com remove_tags', async () => {
        const created = await call(getTool('todo_create'), { title: 'T', tags: ['a', 'b', 'c'] });
        const res = await call(getTool('todo_update'), { id: created.task.id, remove_tags: ['b'] });
        assert.ok(res.task.tags.includes('a'));
        assert.ok(!res.task.tags.includes('b'));
        assert.ok(res.task.tags.includes('c'));
    });

    it('append_notes adiciona ao final das notas existentes', async () => {
        const created = await call(getTool('todo_create'), { title: 'T', notes: 'Nota inicial' });
        const res = await call(getTool('todo_update'), {
            id: created.task.id,
            append_notes: 'Nota adicional',
        });
        assert.ok(res.task.notes.includes('Nota inicial'));
        assert.ok(res.task.notes.includes('Nota adicional'));
    });

    it('faz merge de metadata', async () => {
        const created = await call(getTool('todo_create'), {
            title: 'T',
            metadata: { sprint: 1, estimate: 2 },
        });
        const res = await call(getTool('todo_update'), {
            id: created.task.id,
            metadata: { sprint: 2, extra: 'x' },
        });
        assert.equal(res.task.metadata.sprint, 2);
        assert.equal(res.task.metadata.estimate, 2); // manteve
        assert.equal(res.task.metadata.extra, 'x'); // adicionou
    });

    it('retorna erro para ID inexistente', async () => {
        const res = await call(getTool('todo_update'), { id: 'nope', title: 'X' });
        assert.equal(res.success, false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// todo_set_status
// ─────────────────────────────────────────────────────────────────────────────

describe('todo_set_status', () => {
    it('transição válida: todo → in_progress', async () => {
        const created = await call(getTool('todo_create'), { title: 'T' });
        const res = await call(getTool('todo_set_status'), {
            id: created.task.id,
            status: 'in_progress',
        });
        assert.equal(res.success, true);
        assert.equal(res.task.status, 'in_progress');
        assert.equal(res.previous_status, 'todo');
    });

    it('transição válida: in_progress → done — define completedAt', async () => {
        const created = await call(getTool('todo_create'), { title: 'T' });
        await call(getTool('todo_set_status'), { id: created.task.id, status: 'in_progress' });
        const res = await call(getTool('todo_set_status'), { id: created.task.id, status: 'done' });
        assert.equal(res.task.status, 'done');
        assert.ok(res.task.completedAt);
    });

    it('transição inválida retorna erro com opções permitidas', async () => {
        const created = await call(getTool('todo_create'), { title: 'T' });
        const res = await call(getTool('todo_set_status'), {
            id: created.task.id,
            status: 'done',
        });
        assert.equal(res.success, false);
        assert.ok(res.error.includes('inválida'));
        assert.ok(Array.isArray(res.allowed_transitions));
    });

    it('force=true permite transição fora do grafo', async () => {
        const created = await call(getTool('todo_create'), { title: 'T' });
        const res = await call(getTool('todo_set_status'), {
            id: created.task.id,
            status: 'done',
            force: true,
        });
        assert.equal(res.success, true);
        assert.equal(res.task.status, 'done');
    });

    it('retorna mensagem quando status já é o solicitado', async () => {
        const created = await call(getTool('todo_create'), { title: 'T' });
        const res = await call(getTool('todo_set_status'), { id: created.task.id, status: 'todo' });
        assert.equal(res.success, true);
        assert.ok(res.message.includes('já é'));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// todo_delete
// ─────────────────────────────────────────────────────────────────────────────

describe('todo_delete', () => {
    it('exclui tarefa existente', async () => {
        const created = await call(getTool('todo_create'), { title: 'Para deletar' });
        const res = await call(getTool('todo_delete'), { id: created.task.id });
        assert.equal(res.success, true);
        assert.ok(res.deleted.includes(created.task.id));

        const store = readStore();
        assert.ok(!store.tasks[created.task.id]);
    });

    it('retorna erro para ID inexistente', async () => {
        const res = await call(getTool('todo_delete'), { id: 'ghost123' });
        assert.equal(res.success, false);
    });

    it('desvincula subtarefas sem cascade (tornam-se raiz)', async () => {
        const parent = await call(getTool('todo_create'), { title: 'Pai' });
        const child = await call(getTool('todo_add_subtask'), {
            parent_id: parent.task.id,
            title: 'Filho',
        });

        await call(getTool('todo_delete'), { id: parent.task.id, cascade: false });

        const store = readStore();
        const childTask = store.tasks[child.subtask.id];
        assert.ok(childTask, 'Filho deve continuar existindo');
        assert.equal(childTask.parentId, null, 'Filho deve ser raiz agora');
    });

    it('cascade=true remove subtarefas recursivamente', async () => {
        const parent = await call(getTool('todo_create'), { title: 'Pai' });
        const child = await call(getTool('todo_add_subtask'), {
            parent_id: parent.task.id,
            title: 'Filho',
        });

        const res = await call(getTool('todo_delete'), { id: parent.task.id, cascade: true });
        assert.equal(res.count, 2); // pai + filho

        const store = readStore();
        assert.ok(!store.tasks[parent.task.id]);
        assert.ok(!store.tasks[child.subtask.id]);
    });

    it('remove referência no pai ao deletar subtarefa', async () => {
        const parent = await call(getTool('todo_create'), { title: 'Pai' });
        const child = await call(getTool('todo_add_subtask'), {
            parent_id: parent.task.id,
            title: 'Filho',
        });

        await call(getTool('todo_delete'), { id: child.subtask.id });

        const store = readStore();
        assert.ok(!store.tasks[parent.task.id].subtaskIds.includes(child.subtask.id));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// todo_add_subtask
// ─────────────────────────────────────────────────────────────────────────────

describe('todo_add_subtask', () => {
    it('cria subtarefa vinculada ao pai', async () => {
        const parent = await call(getTool('todo_create'), { title: 'Pai' });
        const res = await call(getTool('todo_add_subtask'), {
            parent_id: parent.task.id,
            title: 'Sub',
        });
        assert.equal(res.success, true);
        assert.equal(res.subtask.parentId, parent.task.id);
        assert.equal(res.parent_subtask_count, 1);
    });

    it('falha com pai inexistente', async () => {
        const res = await call(getTool('todo_add_subtask'), {
            parent_id: 'ghost',
            title: 'Sub sem pai',
        });
        assert.equal(res.success, false);
        assert.ok(res.error.includes('não encontrada'));
    });

    it('múltiplas subtarefas incrementam contagem', async () => {
        const parent = await call(getTool('todo_create'), { title: 'Pai' });
        await call(getTool('todo_add_subtask'), { parent_id: parent.task.id, title: 'Sub1' });
        const res = await call(getTool('todo_add_subtask'), { parent_id: parent.task.id, title: 'Sub2' });
        assert.equal(res.parent_subtask_count, 2);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// todo_search
// ─────────────────────────────────────────────────────────────────────────────

describe('todo_search', () => {
    it('encontra tarefa pelo título', async () => {
        await call(getTool('todo_create'), { title: 'Implementar autenticação JWT' });
        await call(getTool('todo_create'), { title: 'Corrigir layout mobile' });

        const res = await call(getTool('todo_search'), { query: 'autenticação' });
        assert.equal(res.total, 1);
        assert.ok(res.results[0].title.includes('autenticação'));
    });

    it('busca AND implícito com múltiplos termos', async () => {
        await call(getTool('todo_create'), { title: 'Refatorar módulo de auth' });
        await call(getTool('todo_create'), { title: 'Refatorar styles' });
        await call(getTool('todo_create'), { title: 'Testar auth' });

        const res = await call(getTool('todo_search'), { query: 'refatorar auth' });
        assert.equal(res.total, 1);
        assert.ok(res.results[0].title.includes('Refatorar módulo de auth'));
    });

    it('busca em descrição e notas', async () => {
        await call(getTool('todo_create'), {
            title: 'Título genérico',
            description: 'Descricao contendo termoEspecifico',
        });
        const res = await call(getTool('todo_search'), { query: 'termoespecifico' });
        assert.equal(res.total, 1);
    });

    it('busca em tags', async () => {
        await call(getTool('todo_create'), { title: 'T1', tags: ['performance', 'backend'] });
        const res = await call(getTool('todo_search'), { query: 'performance' });
        assert.equal(res.total, 1);
    });

    it('retorna vazio quando não há match', async () => {
        await call(getTool('todo_create'), { title: 'Algo qualquer' });
        const res = await call(getTool('todo_search'), { query: 'termoquenaoexiste99' });
        assert.equal(res.total, 0);
        assert.deepEqual(res.results, []);
    });

    it('filtra por status após busca', async () => {
        await call(getTool('todo_create'), { title: 'Feature A' });
        const t2 = await call(getTool('todo_create'), { title: 'Feature B' });
        await call(getTool('todo_set_status'), { id: t2.task.id, status: 'in_progress' });

        const res = await call(getTool('todo_search'), { query: 'feature', status: 'in_progress' });
        assert.equal(res.total, 1);
        assert.equal(res.results[0].title, 'Feature B');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// todo_stats
// ─────────────────────────────────────────────────────────────────────────────

describe('todo_stats', () => {
    it('retorna stats corretas para store vazio', async () => {
        const res = await call(getTool('todo_stats'), {});
        assert.equal(res.total, 0);
        assert.equal(res.completion_rate, 0);
        assert.deepEqual(res.top_tags, []);
    });

    it('conta tarefas por status', async () => {
        await call(getTool('todo_create'), { title: 'T1' });
        const t2 = await call(getTool('todo_create'), { title: 'T2' });
        await call(getTool('todo_set_status'), { id: t2.task.id, status: 'in_progress' });
        const t3 = await call(getTool('todo_create'), { title: 'T3' });
        await call(getTool('todo_set_status'), { id: t3.task.id, status: 'in_progress' });
        await call(getTool('todo_set_status'), { id: t3.task.id, status: 'done' });

        const res = await call(getTool('todo_stats'), {});
        assert.equal(res.total, 3);
        assert.equal(res.by_status.todo, 1);
        assert.equal(res.by_status.in_progress, 1);
        assert.equal(res.by_status.done, 1);
        assert.equal(res.completion_rate, 33);
    });

    it('conta overdue corretamente', async () => {
        await call(getTool('todo_create'), { title: 'Atrasada', due_date: '2020-01-01T00:00:00Z' });
        await call(getTool('todo_create'), { title: 'Normal' });

        const res = await call(getTool('todo_stats'), {});
        assert.equal(res.overdue, 1);
    });

    it('top_tags agrupa por frequência', async () => {
        await call(getTool('todo_create'), { title: 'T1', tags: ['alpha', 'beta'] });
        await call(getTool('todo_create'), { title: 'T2', tags: ['alpha', 'gamma'] });
        await call(getTool('todo_create'), { title: 'T3', tags: ['alpha'] });

        const res = await call(getTool('todo_stats'), {});
        assert.equal(res.top_tags[0].tag, 'alpha');
        assert.equal(res.top_tags[0].count, 3);
    });

    it('include_recent=false omite lista de recentes', async () => {
        await call(getTool('todo_create'), { title: 'T' });
        const res = await call(getTool('todo_stats'), { include_recent: false });
        assert.deepEqual(res.recent, []);
    });

    it('top_priority_pending exclui done/cancelled', async () => {
        await call(getTool('todo_create'), { title: 'Critica', priority: 'critical' });
        const t2 = await call(getTool('todo_create'), { title: 'Concluida', priority: 'critical' });
        await call(getTool('todo_set_status'), { id: t2.task.id, status: 'in_progress' });
        await call(getTool('todo_set_status'), { id: t2.task.id, status: 'done' });

        const res = await call(getTool('todo_stats'), { include_top_priority: true });
        assert.equal(res.top_priority_pending.length, 1);
        assert.equal(res.top_priority_pending[0].title, 'Critica');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// todo_bulk_update
// ─────────────────────────────────────────────────────────────────────────────

describe('todo_bulk_update', () => {
    it('atualiza status em múltiplos IDs', async () => {
        const t1 = await call(getTool('todo_create'), { title: 'T1' });
        const t2 = await call(getTool('todo_create'), { title: 'T2' });
        const t3 = await call(getTool('todo_create'), { title: 'T3' });

        const res = await call(getTool('todo_bulk_update'), {
            ids: [t1.task.id, t2.task.id, t3.task.id],
            status: 'in_progress',
        });
        assert.equal(res.success, true);
        assert.equal(res.count, 3);

        const store = readStore();
        assert.equal(store.tasks[t1.task.id].status, 'in_progress');
        assert.equal(store.tasks[t2.task.id].status, 'in_progress');
        assert.equal(store.tasks[t3.task.id].status, 'in_progress');
    });

    it('reporta IDs não encontrados em not_found', async () => {
        const t1 = await call(getTool('todo_create'), { title: 'T1' });
        const res = await call(getTool('todo_bulk_update'), {
            ids: [t1.task.id, 'ghost1', 'ghost2'],
            priority: 'high',
        });
        assert.equal(res.count, 1);
        assert.equal(res.not_found.length, 2);
    });

    it('adiciona tags em lote', async () => {
        const t1 = await call(getTool('todo_create'), { title: 'T1', tags: ['old'] });
        const t2 = await call(getTool('todo_create'), { title: 'T2' });
        await call(getTool('todo_bulk_update'), {
            ids: [t1.task.id, t2.task.id],
            add_tags: ['sprint-8'],
        });

        const store = readStore();
        assert.ok(store.tasks[t1.task.id].tags.includes('sprint-8'));
        assert.ok(store.tasks[t1.task.id].tags.includes('old'));
        assert.ok(store.tasks[t2.task.id].tags.includes('sprint-8'));
    });

    it('retorna erro quando nenhum campo foi fornecido', async () => {
        const t1 = await call(getTool('todo_create'), { title: 'T' });
        const res = await call(getTool('todo_bulk_update'), { ids: [t1.task.id] });
        assert.equal(res.success, false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// todo_clear_completed
// ─────────────────────────────────────────────────────────────────────────────

describe('todo_clear_completed', () => {
    it('remove tarefas done e cancelled (both)', async () => {
        const t1 = await call(getTool('todo_create'), { title: 'Ativa' });
        const t2 = await call(getTool('todo_create'), { title: 'Concluida' });
        await call(getTool('todo_set_status'), { id: t2.task.id, status: 'in_progress' });
        await call(getTool('todo_set_status'), { id: t2.task.id, status: 'done' });
        const t3 = await call(getTool('todo_create'), { title: 'Cancelada' });
        await call(getTool('todo_set_status'), { id: t3.task.id, status: 'cancelled' });

        const res = await call(getTool('todo_clear_completed'), { status_filter: 'both' });
        assert.equal(res.count, 2);
        assert.ok(res.deleted.includes(t2.task.id));
        assert.ok(res.deleted.includes(t3.task.id));

        const store = readStore();
        assert.ok(store.tasks[t1.task.id]); // ativa permanece
        assert.ok(!store.tasks[t2.task.id]);
        assert.ok(!store.tasks[t3.task.id]);
    });

    it('dry_run simula sem persistir', async () => {
        const t = await call(getTool('todo_create'), { title: 'Done' });
        await call(getTool('todo_set_status'), { id: t.task.id, status: 'in_progress' });
        await call(getTool('todo_set_status'), { id: t.task.id, status: 'done' });

        const res = await call(getTool('todo_clear_completed'), { dry_run: true });
        assert.equal(res.dry_run, true);
        assert.equal(res.count, 1);

        const store = readStore();
        assert.ok(store.tasks[t.task.id], 'Tarefa deve permanecer no dry_run');
    });

    it('filter=done remove apenas done', async () => {
        const t1 = await call(getTool('todo_create'), { title: 'Done' });
        await call(getTool('todo_set_status'), { id: t1.task.id, status: 'in_progress' });
        await call(getTool('todo_set_status'), { id: t1.task.id, status: 'done' });
        const t2 = await call(getTool('todo_create'), { title: 'Cancelada' });
        await call(getTool('todo_set_status'), { id: t2.task.id, status: 'cancelled' });

        const res = await call(getTool('todo_clear_completed'), { status_filter: 'done' });
        assert.equal(res.count, 1);
        assert.ok(res.deleted.includes(t1.task.id));

        const store = readStore();
        assert.ok(store.tasks[t2.task.id], 'Cancelada deve permanecer');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// todo_import
// ─────────────────────────────────────────────────────────────────────────────

describe('todo_import', () => {
    it('importa array de tarefas', async () => {
        const res = await call(getTool('todo_import'), {
            tasks: [{ title: 'Task A' }, { title: 'Task B' }, { title: 'Task C' }],
        });
        assert.equal(res.success, true);
        assert.equal(res.count, 3);
        assert.equal(res.created_ids.length, 3);

        const store = readStore();
        assert.equal(Object.keys(store.tasks).length, 3);
    });

    it('usa prioridade padrão quando não fornecida', async () => {
        const res = await call(getTool('todo_import'), {
            tasks: [{ title: 'T' }],
            default_priority: 'high',
        });
        const store = readStore();
        assert.equal(store.tasks[res.created_ids[0]].priority, 'high');
    });

    it('preserva campos opcionais fornecidos', async () => {
        const res = await call(getTool('todo_import'), {
            tasks: [
                {
                    title: 'Com campos',
                    priority: 'critical',
                    tags: ['import', 'test'],
                    notes: 'Nota importada',
                },
            ],
        });
        const store = readStore();
        const task = store.tasks[res.created_ids[0]];
        assert.equal(task.priority, 'critical');
        assert.deepEqual(task.tags, ['import', 'test']);
        assert.equal(task.notes, 'Nota importada');
    });

    it('gera IDs únicos para cada tarefa importada', async () => {
        const res = await call(getTool('todo_import'), {
            tasks: [{ title: 'T1' }, { title: 'T2' }, { title: 'T3' }],
        });
        const uniqueIds = new Set(res.created_ids);
        assert.equal(uniqueIds.size, 3);
    });
});
