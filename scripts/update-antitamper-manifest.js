#!/usr/bin/env node
/**
 * Anti-Tamper Manifest Updater
 * --------------------------------------------------------------
 * Recomputes SHA-256 hashes for the file-protection module's
 * critical files and embeds them inline in both `src/bot.js`
 * and `start-bot.js` between the markers:
 *
 *     // === ANTI-TAMPER PRE-FLIGHT (auto-generated, do not edit by hand) ===
 *     ...
 *     // === END ANTI-TAMPER PRE-FLIGHT ===
 *
 * Run this AFTER you legitimately edit any file under
 * `file-protection/` (or the guard module itself), then commit
 * the updated bot.js / start-bot.js with the new hashes.
 *
 * Usage:
 *     node scripts/update-antitamper-manifest.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

// Files whose integrity is enforced at startup.
// Paths are relative to ROOT (the bot project root).
const PROTECTED_FILES = [
    'file-protection/index.js',
    'file-protection/agent/watcher.js',
    'file-protection/agent/validator.js',
    'file-protection/agent/baseline-manager.js',
    'file-protection/agent/protector.js',
    'file-protection/agent/response-handler.js',
    'file-protection/agent/file-enumerator.js',
    'file-protection/agent/environment-guard.js',
    'file-protection/agent/hasher.js',
    'file-protection/agent/constants.js',
    'src/utils/antiTamperGuard.js'
];

function sha256(file) {
    const buf = fs.readFileSync(file);
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function buildManifest() {
    const manifest = {};
    for (const rel of PROTECTED_FILES) {
        const abs = path.join(ROOT, rel);
        if (!fs.existsSync(abs)) {
            console.error(`[antitamper] ERROR: missing required file: ${rel}`);
            process.exit(1);
        }
        manifest[rel] = sha256(abs);
    }
    return manifest;
}

function renderPreflightBlock(manifest, fromFileRelDir) {
    // fromFileRelDir = directory the bot file is in, relative to ROOT.
    // We compute the path FROM that directory TO each protected file
    // so the embedded snippet uses simple relative paths against __dirname.
    const entries = Object.entries(manifest).map(([rel, hash]) => {
        const relFromBot = path.relative(fromFileRelDir, rel).split(path.sep).join('/');
        return `        ${JSON.stringify(relFromBot)}: ${JSON.stringify(hash)}`;
    });

    return [
        '// === ANTI-TAMPER PRE-FLIGHT (auto-generated, do not edit by hand) ===',
        '// Regenerate via: node scripts/update-antitamper-manifest.js',
        '(function antiTamperPreflight() {',
        "    const _fs = require('fs');",
        "    const _path = require('path');",
        "    const _crypto = require('crypto');",
        '    const REQUIRED = {',
        entries.join(',\n'),
        '    };',
        '    const failures = [];',
        '    for (const rel of Object.keys(REQUIRED)) {',
        '        const abs = _path.join(__dirname, rel);',
        '        if (!_fs.existsSync(abs)) { failures.push(`MISSING: ${rel}`); continue; }',
        '        try {',
        '            const h = _crypto.createHash(\'sha256\').update(_fs.readFileSync(abs)).digest(\'hex\');',
        '            if (h !== REQUIRED[rel]) failures.push(`MODIFIED: ${rel} (expected ${REQUIRED[rel].slice(0,12)}.., got ${h.slice(0,12)}..)`);',
        '        } catch (e) { failures.push(`UNREADABLE: ${rel} - ${e.message}`); }',
        '    }',
        '    if (failures.length) {',
        '        process.stderr.write(\'\\n\\x1b[1;31m╔══════════════════════════════════════════════════════════════╗\\n\');',
        '        process.stderr.write(\'║   ANTI-TAMPER PRE-FLIGHT FAILED — REFUSING TO START BOT      ║\\n\');',
        '        process.stderr.write(\'╚══════════════════════════════════════════════════════════════╝\\x1b[0m\\n\');',
        '        for (const f of failures) process.stderr.write(`  • ${f}\\n`);',
        '        process.stderr.write(\'\\nThe file-integrity protection system has been tampered with or removed.\\n\');',
        '        process.stderr.write(\'If this change was intentional, run:\\n\');',
        '        process.stderr.write(\'   node scripts/update-antitamper-manifest.js\\n\');',
        '        process.stderr.write(\'and restart.\\n\\n\');',
        '        process.exit(7);',
        '    }',
        '})();',
        '// === END ANTI-TAMPER PRE-FLIGHT ==='
    ].join('\n');
}

function patchFile(absPath, fromFileRelDir, manifest) {
    const original = fs.readFileSync(absPath, 'utf8');
    const startMarker = '// === ANTI-TAMPER PRE-FLIGHT (auto-generated, do not edit by hand) ===';
    const endMarker = '// === END ANTI-TAMPER PRE-FLIGHT ===';

    const newBlock = renderPreflightBlock(manifest, fromFileRelDir);

    let updated;
    if (original.includes(startMarker) && original.includes(endMarker)) {
        const before = original.slice(0, original.indexOf(startMarker));
        const after = original.slice(original.indexOf(endMarker) + endMarker.length);
        updated = before + newBlock + after;
    } else {
        // First-time install: insert at the very top (after a leading shebang if present).
        if (original.startsWith('#!')) {
            const nl = original.indexOf('\n');
            updated = original.slice(0, nl + 1) + '\n' + newBlock + '\n\n' + original.slice(nl + 1);
        } else {
            updated = newBlock + '\n\n' + original;
        }
    }

    if (updated === original) {
        console.log(`[antitamper] ${path.relative(ROOT, absPath)}: unchanged`);
    } else {
        fs.writeFileSync(absPath, updated);
        console.log(`[antitamper] ${path.relative(ROOT, absPath)}: pre-flight block updated`);
    }
}

function main() {
    console.log('[antitamper] Computing manifest…');
    const manifest = buildManifest();
    for (const [rel, hash] of Object.entries(manifest)) {
        console.log(`  ${hash.slice(0, 16)}…  ${rel}`);
    }

    // src/bot.js  →  paths are relative to "src" directory
    patchFile(path.join(ROOT, 'src', 'bot.js'), 'src', manifest);
    // start-bot.js  →  paths are relative to project root
    patchFile(path.join(ROOT, 'start-bot.js'), '.', manifest);

    console.log('\n[antitamper] Done. Restart the bot to verify the new manifest.');
}

if (require.main === module) main();
