# Build Darklock Guard for Linux using Docker
# This script can be run on Windows to build Linux packages

Write-Host "======================================"  -ForegroundColor Cyan
Write-Host "Building Darklock Guard for Linux"     -ForegroundColor Cyan
Write-Host "======================================"  -ForegroundColor Cyan
Write-Host ""

# Check if Docker is installed
try {
    docker --version | Out-Null
} catch {
    Write-Host "Error: Docker not found. Please install Docker Desktop." -ForegroundColor Red
    Write-Host "Download from: https://www.docker.com/products/docker-desktop" -ForegroundColor Yellow
    exit 1
}

# Set paths
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$downloadsDir = Join-Path (Split-Path (Split-Path $scriptDir -Parent) -Parent) "darklock\downloads"

Write-Host "Building Docker image..." -ForegroundColor Yellow
docker build -f "$scriptDir\Dockerfile.linux" -t darklock-guard-builder "$scriptDir"

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Docker build failed" -ForegroundColor Red
    exit 1
}

Write-Host "Running build in container..." -ForegroundColor Yellow
docker run --name darklock-build darklock-guard-builder

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Build failed in container" -ForegroundColor Red
    docker rm darklock-build 2>$null
    exit 1
}

# Create downloads directory if it doesn't exist
if (-not (Test-Path $downloadsDir)) {
    New-Item -ItemType Directory -Path $downloadsDir | Out-Null
}

Write-Host "Extracting build artifacts..." -ForegroundColor Yellow

# Copy .deb file
Write-Host "  - Copying .deb package..." -ForegroundColor Gray
docker cp darklock-build:/app/src-tauri/target/release/bundle/deb/darklock-guard_1.0.0_amd64.deb "$downloadsDir\"

# Copy .rpm file
Write-Host "  - Copying .rpm package..." -ForegroundColor Gray
docker cp darklock-build:/app/src-tauri/target/release/bundle/rpm/darklock-guard-1.0.0-1.x86_64.rpm "$downloadsDir\"

# Copy tar.gz if it exists
Write-Host "  - Copying tar.gz archive..." -ForegroundColor Gray
docker cp darklock-build:/app/src-tauri/target/release/darklock-guard-linux-x64.tar.gz "$downloadsDir\" 2>$null

# Clean up container
Write-Host "Cleaning up..." -ForegroundColor Yellow
docker rm darklock-build | Out-Null

Write-Host ""
Write-Host "======================================"  -ForegroundColor Green
Write-Host "Build Complete!"                        -ForegroundColor Green
Write-Host "======================================"  -ForegroundColor Green
Write-Host ""
Write-Host "Output files copied to:" -ForegroundColor Cyan
Write-Host "  $downloadsDir" -ForegroundColor White
Write-Host ""
Get-ChildItem "$downloadsDir\*.deb", "$downloadsDir\*.rpm", "$downloadsDir\*.tar.gz" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "  ✓ $($_.Name)" -ForegroundColor Green
}
Write-Host ""
Write-Host "You can now download these from:" -ForegroundColor Cyan
Write-Host "  http://localhost:3002/platform/download/darklock-guard" -ForegroundColor White
Write-Host ""
