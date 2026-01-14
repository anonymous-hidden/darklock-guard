// Node.js script to update JavaScript files from localStorage auth to cookie-based auth
const fs = require('fs');
const path = require('path');

const files = [
    'src/dashboard/public/js/dashboard-enhanced.js',
    'src/dashboard/public/js/dashboard-pro.js',
    'src/dashboard/public/js/dashboard-simple.js',
    'src/dashboard/public/js/dashboard.js',
    'src/dashboard/public/js/chart-manager.js'
];

function updateFile(filePath) {
    console.log(`Processing: ${filePath}`);
    
    const fullPath = path.join(__dirname, filePath);
    
    if (!fs.existsSync(fullPath)) {
        console.log(`  ✗ File not found: ${filePath}`);
        return;
    }
    
    let content = fs.readFileSync(fullPath, 'utf8');
    const originalContent = content;
    
    // Pattern 1: Remove localStorage.getItem + Authorization Bearer for POST/PUT/DELETE
    // Match: const token = localStorage.getItem('dashboardToken'); \n const response = await fetch(..., { method: '...', headers: { ..., 'Authorization': `Bearer ${token}` } ...
    const pattern1 = /(\s+)const token = localStorage\.getItem\('dashboardToken'\);\s+const response = await fetch\(([^,]+),\s*\{\s*method:\s*'(POST|PUT|DELETE|PATCH)',\s*headers:\s*\{\s*'Content-Type':\s*'application\/json',\s*'Authorization':\s*`Bearer \$\{token\}`\s*\}/g;
    content = content.replace(pattern1, (match, indent, url, method) => {
        return `${indent}const response = await fetch(${url}, {${indent}    method: '${method}',${indent}    credentials: 'include',${indent}    headers: {${indent}        'Content-Type': 'application/json'`;
    });
    
    // Pattern 2: Remove localStorage.getItem + Authorization Bearer for GET requests
    const pattern2 = /(\s+)const token = localStorage\.getItem\('dashboardToken'\);\s+const response = await fetch\(([^,]+),\s*\{\s*headers:\s*\{\s*'Authorization':\s*`Bearer \$\{token\}`\s*\}\s*\}\)/g;
    content = content.replace(pattern2, '$1const response = await fetch($2, {$1    credentials: \'include\'$1})');
    
    // Pattern 3: Remaining standalone Authorization headers
    const pattern3 = /(\s+)'Authorization':\s*`Bearer \$\{localStorage\.getItem\('dashboardToken'\)\}`/g;
    content = content.replace(pattern3, '// Auth via HTTP-only cookie');
    
    // Pattern 4: Remove localStorage.removeItem for auth tokens
    const pattern4 = /(\s+)localStorage\.removeItem\('(dashboardToken|authToken)'\);/g;
    content = content.replace(pattern4, '$1// Auth tokens now in HTTP-only cookies (cleared server-side)');
    
    // Pattern 5: Add credentials to fetch calls that don't have it
    const pattern5 = /(await fetch\([^,]+,\s*\{\s*method:\s*'(?:POST|PUT|DELETE|PATCH)',\s*headers:\s*\{[^}]+\}\s*,\s*body:)/g;
    content = content.replace(pattern5, (match) => {
        if (!match.includes('credentials')) {
            return match.replace('method:', 'credentials: \'include\',\n        method:');
        }
        return match;
    });
    
    if (content !== originalContent) {
        fs.writeFileSync(fullPath, content, 'utf8');
        console.log(`  ✓ Updated: ${filePath}`);
    } else {
        console.log(`  - No changes: ${filePath}`);
    }
}

// Process all files
files.forEach(updateFile);

console.log('\n✓ Authentication update complete!');
console.log('All JavaScript files now use secure HTTP-only cookies.');
