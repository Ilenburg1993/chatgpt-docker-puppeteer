import './lib/env-bootstrap.mjs';
import { parseArgs } from 'node:util';
import { ragHealth } from './lib/facade.mjs';

const { values } = parseArgs({
    options: {
        'ollama-base-url': { type: 'string' },
        model: { type: 'string' },
        json: { type: 'boolean', default: false },
    },
});

const report = await ragHealth({
    ollamaBaseUrl: values['ollama-base-url'],
    model: values.model,
});

if (values.json) {
    console.log(JSON.stringify(report, null, 2));
} else {
    // Human-friendly output with checkmarks
    console.log('\n[RAG Health Check]');
    console.log(`  Overall:          ${report.ok ? '✅ OK' : '❌ FAILED'}`);
    console.log(`  Directories:      ${report.writable ? '✅' : '❌'} Writable`);
    console.log(`  Manifest:         ${report.manifest_ok ? '✅' : '❌'} ${report.manifest_ok ? 'Valid' : 'Error'}`);
    console.log(
        `  Ollama:           ${report.ollama?.ok ? '✅' : '❌'} ${report.ollama?.ok ? 'Connected' : 'Unreachable'}`
    );
    console.log(
        `  Embedding Model:  ${report.ollama?.hasModel ? '✅' : '❌'} ${report.ollama?.hasModel ? report.manifest?.embedding?.model || 'nomic-embed-text:latest' : 'Not found'}`
    );
    console.log(
        `  LanceDB:          ${report.lancedb?.ok ? '✅' : '❌'} ${report.lancedb?.ok ? 'Accessible' : 'Error'}`
    );
    console.log(`  Index Available:  ${report.available ? '✅' : '❌'} ${report.available ? 'Ready' : 'Not ready'}`);
    if (report.active_scope_defaults) {
        console.log(
            `  Active Scope:     profile=${report.active_scope_defaults.profile} docs=${report.active_scope_defaults.docs_mode} hash=${report.active_scope_defaults.scope_hash}`
        );
    }
    if (report.last_index_scope) {
        console.log(
            `  Last Index Scope: profile=${report.last_index_scope.profile} docs=${report.last_index_scope.docs_mode} hash=${report.last_index_scope.scope_hash || report.scope_hash}`
        );
    }

    if (!report.ok) {
        console.log('\n[Troubleshooting]');
        if (!report.ollama?.ok) {
            console.log('  • Check Ollama: curl http://host.docker.internal:11434/api/version');
        }
        if (!report.ollama?.hasModel) {
            console.log('  • Install model: ollama pull nomic-embed-text:latest');
        }
        if (!report.manifest_ok) {
            console.log('  • Reset index: npm run rag:reset -- --yes');
        }
    }
    console.log('');
}

process.exit(report.ok ? 0 : 1);
