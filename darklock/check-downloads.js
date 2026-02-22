/**
 * Startup check for Darklock Guard installer files
 * Verifies that installer files are present and accessible
 * NOTE: Missing installer files log warnings but do not crash the container
 */

const fs = require('fs');
const path = require('path');

const downloadsDir = path.join(__dirname, 'downloads');
const expectedFiles = [
    'darklock-guard-setup.exe',
    'darklock-guard-setup.msi',
    'darklock-guard-installer.msi',
    'darklocksetup.exe',
    'darklock-guard_0.1.0_amd64.deb',
    'darklock-guard-linux-portable.tar.gz',
    'darklock-secure-channel-setup.exe',
    'darklock-secure-channel-setup.msi'
];

console.log('[Darklock] Checking installer files...');
console.log('[Darklock] Downloads directory:', downloadsDir);

// Check if downloads directory exists
if (!fs.existsSync(downloadsDir)) {
    console.warn('[Darklock] ⚠️  Downloads directory not found (optional feature)');
    console.warn('[Darklock] Download functionality will be unavailable until installers are added');
    return;
}

// List all files in downloads
const files = fs.readdirSync(downloadsDir);
console.log('[Darklock] Files in downloads folder:', files);

// Check for at least one installer
const hasInstaller = expectedFiles.some(file => files.includes(file));

if (!hasInstaller) {
    console.warn('[Darklock] ⚠️  No installer files found (optional feature)');
    console.warn('[Darklock] Expected at least one of:', expectedFiles);
    console.warn('[Darklock] Download functionality will be unavailable until installers are added');
    return;
}

console.log('[Darklock] ✅ Installer files verified');

// Print file sizes
files.forEach(file => {
    const filePath = path.join(downloadsDir, file);
    const stats = fs.statSync(filePath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    console.log(`[Darklock]   - ${file}: ${sizeMB} MB`);
});

console.log('[Darklock] Installer check complete');
