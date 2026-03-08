import fs from 'fs';

const files = [
    'src/core/forensics.js',
    'src/driver/extractors/structured_extractor.js',
    'src/driver/modules/biomechanics_engine.js',
    'src/driver/modules/frame_navigator.js',
    'src/driver/modules/submission_controller.js',
    'src/driver/modules/triage.js',
    'src/driver/targets/ChatGPTDriver.js',
    'src/infra/browser_pool/PageValidator.js',
    'src/shared/biomechanics/human.js',
    'src/shared/page_stability/stabilizer.js',
    'src/shared/sadi/analyzer.js',
    'test-proxy-final.js',
    'tests/manual/test_chrome_connection.js',
];

const browserGlobals =
    '/* global document, window, CSS, Node, NodeFilter, MutationObserver, navigator, HTMLElement */\n';

for (const file of files) {
    try {
        const content = fs.readFileSync(file, 'utf8');

        // Skip if already has global declaration
        if (content.includes('/* global document')) {
            console.log(`⏭️  ${file}: já tem declaração global`);
            continue;
        }

        // Find first non-comment, non-import line to insert after
        const lines = content.split('\n');
        let insertIndex = 0;

        // Skip shebang
        if (lines[0].startsWith('#!')) insertIndex = 1;

        // Skip existing comments at top
        while (
            insertIndex < lines.length &&
            (lines[insertIndex].trim().startsWith('//') ||
                lines[insertIndex].trim().startsWith('/*') ||
                lines[insertIndex].trim().startsWith('*') ||
                lines[insertIndex].trim() === '')
        ) {
            insertIndex++;
        }

        // Insert global declaration
        lines.splice(insertIndex, 0, browserGlobals.trimEnd());

        fs.writeFileSync(file, lines.join('\n'));
        console.log(`✅ ${file}: global declaration added`);
    } catch (err) {
        console.error(`❌ ${file}: ${err.message}`);
    }
}

console.log('\n✅ Browser globals added to all files');
