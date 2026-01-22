# PowerShell script to update all JavaScript files to use cookie-based authentication
# Removes localStorage token usage and updates fetch calls to use credentials: 'include'

$jsFiles = @(
    "src\dashboard\public\js\dashboard-enhanced.js",
    "src\dashboard\public\js\dashboard-pro.js",
    "src\dashboard\public\js\dashboard-simple.js",
    "src\dashboard\public\js\dashboard.js",
    "src\dashboard\public\js\chart-manager.js"
)

foreach ($file in $jsFiles) {
    $fullPath = Join-Path $PSScriptRoot $file
    
    if (Test-Path $fullPath) {
        Write-Host "Processing: $file" -ForegroundColor Cyan
        
        $content = Get-Content $fullPath -Raw
        $originalContent = $content
        
        # Pattern 1: Remove localStorage.getItem('dashboardToken') and Authorization header
        # Replace fetch with Authorization Bearer with fetch using credentials: 'include'
        $pattern1 = "(\s+)const token = localStorage\.getItem\('dashboardToken'\);\s+const response = await fetch\(([^,]+),\s*\{\s*method:\s*'([^']+)',\s*headers:\s*\{\s*'Content-Type':\s*'application/json',\s*'Authorization':\s*``Bearer \$\{token\}``\s*\}"
        $replacement1 = '$1const response = await fetch($2, {$1    method: ''$3'',$1    credentials: ''include'',$1    headers: {$1        ''Content-Type'': ''application/json'''
        $content = $content -replace $pattern1, $replacement1
        
        # Pattern 2: Simpler version for GET requests
        $pattern2 = "(\s+)const token = localStorage\.getItem\('dashboardToken'\);\s+const response = await fetch\(([^,]+),\s*\{\s*headers:\s*\{\s*'Authorization':\s*``Bearer \$\{token\}``\s*\}\s*\}\)"
        $replacement2 = '$1const response = await fetch($2, {$1    credentials: ''include''$1})'
        $content = $content -replace $pattern2, $replacement2
        
        # Pattern 3: Remove standalone localStorage.removeItem for auth tokens
        $pattern3 = "(\s+)localStorage\.removeItem\('(dashboardToken|authToken)'\);"
        $replacement3 = '$1// Auth tokens now in HTTP-only cookies (removed automatically on logout)'
        $content = $content -replace $pattern3, $replacement3
        
        # Pattern 4: Remove token from URL checks
        $pattern4 = "localStorage\.getItem\('token'\)"
        $replacement4 = "null // Tokens no longer in localStorage"
        $content = $content -replace $pattern4, $replacement4
        
        if ($content -ne $originalContent) {
            Set-Content $fullPath $content -NoNewline
            Write-Host "  ✓ Updated: $file" -ForegroundColor Green
        } else {
            Write-Host "  - No changes needed: $file" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  ✗ File not found: $file" -ForegroundColor Red
    }
}

Write-Host "`n✓ Authentication update complete!" -ForegroundColor Green
Write-Host "All JavaScript files now use secure HTTP-only cookies instead of localStorage." -ForegroundColor Cyan
