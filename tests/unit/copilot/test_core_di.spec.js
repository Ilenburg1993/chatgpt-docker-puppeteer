// @ts-check
/**
 * tests/unit/copilot/test_core_di.spec.js
 *
 * Testes unitários — core/di.js: createToken, createContainer, lifecycle, fork, dispose.
 */

import assert from 'node:assert/strict';

import { createContainer, createToken } from '../../../src/copilot/core/di.js';

// ─── createToken ──────────────────────────────────────────────────────────────

describe('core/di.js › createToken', () => {
    it('cria token com nome e _id symbol', () => {
        const t = createToken('MY_TOKEN');
        assert.equal(t.name, 'MY_TOKEN');
        assert.equal(typeof t._id, 'symbol');
    });

    it('tokens com mesmo nome são distintos', () => {
        const a = createToken('X');
        const b = createToken('X');
        assert.notEqual(a._id, b._id);
    });

    it('rejeita nome vazio', () => {
        assert.throws(() => createToken(''), TypeError);
    });

    it('rejeita nome não-string', () => {
        // @ts-expect-error — teste de runtime
        assert.throws(() => createToken(42), TypeError);
        // @ts-expect-error — teste de runtime
        assert.throws(() => createToken(null), TypeError);
    });
});

// ─── createContainer — register / resolve ─────────────────────────────────────

describe('core/di.js › createContainer › register & resolve', () => {
    it('registra e resolve valor singleton', () => {
        const TOKEN = createToken('A');
        const c = createContainer();
        c.register(TOKEN, () => 42);
        assert.equal(c.resolve(TOKEN), 42);
    });

    it('register retorna container (chaining)', () => {
        const A = createToken('A');
        const B = createToken('B');
        const c = createContainer();
        const result = c.register(A, () => 1).register(B, () => 2);
        assert.equal(result, c);
        assert.equal(c.resolve(A), 1);
        assert.equal(c.resolve(B), 2);
    });

    it('resolve lança para token não registrado', () => {
        const TOKEN = createToken('MISSING');
        const c = createContainer();
        assert.throws(() => c.resolve(TOKEN), { message: "Token 'MISSING' not registered" });
    });

    it('rejeita token inválido em register', () => {
        const c = createContainer();
        // @ts-expect-error — teste de runtime
        assert.throws(() => c.register(null, () => 1), TypeError);
    });

    it('rejeita factory não-função', () => {
        const TOKEN = createToken('X');
        const c = createContainer();
        // @ts-expect-error — teste de runtime
        assert.throws(() => c.register(TOKEN, 'not-a-fn'), TypeError);
    });

    it('rejeita token inválido em resolve', () => {
        const c = createContainer();
        // @ts-expect-error — teste de runtime
        assert.throws(() => c.resolve(null), TypeError);
    });
});

// ─── has ──────────────────────────────────────────────────────────────────────

describe('core/di.js › createContainer › has', () => {
    it('retorna true para token registrado', () => {
        const TOKEN = createToken('H');
        const c = createContainer();
        c.register(TOKEN, () => 'val');
        assert.equal(c.has(TOKEN), true);
    });

    it('retorna false para token não registrado', () => {
        const TOKEN = createToken('NOPE');
        const c = createContainer();
        assert.equal(c.has(TOKEN), false);
    });

    it('retorna false para token inválido', () => {
        const c = createContainer();
        // @ts-expect-error — teste de runtime
        assert.equal(c.has(null), false);
    });
});

// ─── Lifecycle: singleton ─────────────────────────────────────────────────────

describe('core/di.js › lifecycle › singleton', () => {
    it('retorna mesma instância em múltiplos resolve', () => {
        const TOKEN = createToken('S');
        const c = createContainer();
        let count = 0;
        c.register(TOKEN, () => ({ id: ++count }), 'singleton');
        const a = c.resolve(TOKEN);
        const b = c.resolve(TOKEN);
        assert.equal(a, b);
        assert.equal(a.id, 1);
        assert.equal(count, 1);
    });
});

// ─── Lifecycle: transient ─────────────────────────────────────────────────────

describe('core/di.js › lifecycle › transient', () => {
    it('retorna nova instância a cada resolve', () => {
        const TOKEN = createToken('T');
        const c = createContainer();
        let count = 0;
        c.register(TOKEN, () => ({ id: ++count }), 'transient');
        const a = c.resolve(TOKEN);
        const b = c.resolve(TOKEN);
        assert.notEqual(a, b);
        assert.equal(a.id, 1);
        assert.equal(b.id, 2);
    });
});

// ─── Lifecycle: scoped ────────────────────────────────────────────────────────

describe('core/di.js › lifecycle › scoped', () => {
    it('comporta-se como transient no root', () => {
        const TOKEN = createToken('SC');
        const c = createContainer();
        let count = 0;
        c.register(TOKEN, () => ({ id: ++count }), 'scoped');
        const a = c.resolve(TOKEN);
        const b = c.resolve(TOKEN);
        assert.notEqual(a, b);
    });

    it('comporta-se como singleton no child (fork)', () => {
        const TOKEN = createToken('SC2');
        const root = createContainer();
        let count = 0;
        root.register(TOKEN, () => ({ id: ++count }), 'scoped');

        const child = root.fork();
        child.register(TOKEN, () => ({ id: ++count }), 'scoped');
        const a = child.resolve(TOKEN);
        const b = child.resolve(TOKEN);
        assert.equal(a, b); // singleton no child
    });
});

// ─── fork ─────────────────────────────────────────────────────────────────────

describe('core/di.js › fork', () => {
    it('child herda registros do parent', () => {
        const TOKEN = createToken('P');
        const root = createContainer();
        root.register(TOKEN, () => 'parent-val');
        const child = root.fork();
        assert.equal(child.resolve(TOKEN), 'parent-val');
    });

    it('child pode sobrescrever registros do parent', () => {
        const TOKEN = createToken('O');
        const root = createContainer();
        root.register(TOKEN, () => 'root');
        const child = root.fork();
        child.register(TOKEN, () => 'child');
        assert.equal(child.resolve(TOKEN), 'child');
        assert.equal(root.resolve(TOKEN), 'root'); // root não afetado
    });

    it('child.has retorna true para tokens do parent', () => {
        const TOKEN = createToken('HP');
        const root = createContainer();
        root.register(TOKEN, () => 1);
        const child = root.fork();
        assert.equal(child.has(TOKEN), true);
    });

    it('child pode registrar tokens próprios', () => {
        const PARENT_TOKEN = createToken('PT');
        const CHILD_TOKEN = createToken('CT');
        const root = createContainer();
        root.register(PARENT_TOKEN, () => 'p');
        const child = root.fork();
        child.register(CHILD_TOKEN, () => 'c');
        assert.equal(child.resolve(CHILD_TOKEN), 'c');
        assert.equal(root.has(CHILD_TOKEN), false);
    });
});

// ─── dispose ──────────────────────────────────────────────────────────────────

describe('core/di.js › dispose', () => {
    it('dispose bloqueia resolve e register', () => {
        const TOKEN = createToken('D');
        const c = createContainer();
        c.register(TOKEN, () => 1);
        c.dispose();
        assert.throws(() => c.resolve(TOKEN), /disposed/);
        assert.throws(() => c.register(TOKEN, () => 2), /disposed/);
    });

    it('dispose é idempotente', () => {
        const c = createContainer();
        c.dispose();
        c.dispose(); // não lança
    });

    it('dispose invoca .dispose() em singletons', () => {
        let disposed = false;
        const TOKEN = createToken('DS');
        const c = createContainer();
        c.register(TOKEN, () => ({ dispose: () => { disposed = true; } }), 'singleton');
        c.resolve(TOKEN); // cria instância
        c.dispose();
        assert.equal(disposed, true);
    });

    it('dispose invoca .close() em singletons sem .dispose()', () => {
        let closed = false;
        const TOKEN = createToken('CL');
        const c = createContainer();
        c.register(TOKEN, () => ({ close: () => { closed = true; } }), 'singleton');
        c.resolve(TOKEN);
        c.dispose();
        assert.equal(closed, true);
    });

    it('dispose invoca .destroy() em singletons sem .dispose()/.close()', () => {
        let destroyed = false;
        const TOKEN = createToken('DE');
        const c = createContainer();
        c.register(TOKEN, () => ({ destroy: () => { destroyed = true; } }), 'singleton');
        c.resolve(TOKEN);
        c.dispose();
        assert.equal(destroyed, true);
    });

    it('dispose children antes do parent', () => {
        const order = [];
        const root = createContainer();
        const RT = createToken('ROOT');
        root.register(RT, () => ({ dispose: () => order.push('root') }), 'singleton');
        root.resolve(RT);

        const child = root.fork();
        const CT = createToken('CHILD');
        child.register(CT, () => ({ dispose: () => order.push('child') }), 'singleton');
        child.resolve(CT);

        root.dispose();
        assert.deepEqual(order, ['child', 'root']);
    });

    it('dispose em ordem reversa de registro', () => {
        const order = [];
        const A = createToken('A');
        const B = createToken('B');
        const C = createToken('C');
        const c = createContainer();
        c.register(A, () => ({ dispose: () => order.push('A') }), 'singleton');
        c.register(B, () => ({ dispose: () => order.push('B') }), 'singleton');
        c.register(C, () => ({ dispose: () => order.push('C') }), 'singleton');
        c.resolve(A);
        c.resolve(B);
        c.resolve(C);
        c.dispose();
        assert.deepEqual(order, ['C', 'B', 'A']);
    });

    it('has retorna false após dispose', () => {
        const TOKEN = createToken('HD');
        const c = createContainer();
        c.register(TOKEN, () => 1);
        c.dispose();
        assert.equal(c.has(TOKEN), false);
    });

    it('fork bloqueia após dispose', () => {
        const c = createContainer();
        c.dispose();
        assert.throws(() => c.fork(), /disposed/);
    });
});

// ─── tokens() ─────────────────────────────────────────────────────────────────

describe('core/di.js › tokens()', () => {
    it('lista nomes dos tokens registrados', () => {
        const A = createToken('ALPHA');
        const B = createToken('BETA');
        const c = createContainer();
        c.register(A, () => 1);
        c.register(B, () => 2);
        const names = c.tokens();
        assert.deepEqual([...names].sort(), ['ALPHA', 'BETA']);
    });

    it('lista vazia quando nenhum registro', () => {
        const c = createContainer();
        assert.deepEqual(c.tokens(), []);
    });
});

// ─── DI resolution chain ─────────────────────────────────────────────────────

describe('core/di.js › dependency chain', () => {
    it('factory pode resolver outros tokens via container', () => {
        const DB = createToken('DB');
        const REPO = createToken('REPO');
        const c = createContainer();
        c.register(DB, () => ({ query: (q) => `result:${q}` }));
        c.register(REPO, (container) => {
            const db = container.resolve(DB);
            return { find: (id) => db.query(`SELECT * WHERE id=${id}`) };
        });
        const repo = c.resolve(REPO);
        assert.equal(repo.find(1), 'result:SELECT * WHERE id=1');
    });

    it('re-register invalida cache singleton', () => {
        const TOKEN = createToken('RE');
        const c = createContainer();
        c.register(TOKEN, () => 'v1');
        assert.equal(c.resolve(TOKEN), 'v1');
        c.register(TOKEN, () => 'v2');
        assert.equal(c.resolve(TOKEN), 'v2');
    });
});
