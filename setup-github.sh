#!/bin/bash

# Darklock Guard - GitHub Repository Setup Script
# This script helps initialize and push your repository to GitHub

set -e

echo "🛡️  Darklock Guard - GitHub Setup"
echo "=================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "Cargo.toml" ] || [ ! -d "desktop" ]; then
    echo -e "${RED}❌ Error: Please run this script from the guard-v2 directory${NC}"
    exit 1
fi

echo -e "${YELLOW}📋 Pre-flight checks...${NC}"

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo -e "${RED}❌ Git is not installed. Please install git first.${NC}"
    exit 1
fi

# Check for sensitive files
echo -e "${YELLOW}🔍 Checking for sensitive files...${NC}"
SENSITIVE_FILES=$(find . -type f \( -name "*.key" -o -name "*.pem" -o -name "*.p12" -o -name ".env" \) 2>/dev/null | grep -v node_modules || true)

if [ -n "$SENSITIVE_FILES" ]; then
    echo -e "${RED}⚠️  Warning: Found potential sensitive files:${NC}"
    echo "$SENSITIVE_FILES"
    echo ""
    read -p "These files should NOT be committed. Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborting."
        exit 1
    fi
fi

# Initialize git if needed
if [ ! -d ".git" ]; then
    echo -e "${YELLOW}📦 Initializing git repository...${NC}"
    git init
    echo -e "${GREEN}✓ Git initialized${NC}"
else
    echo -e "${GREEN}✓ Git repository already initialized${NC}"
fi

# Get GitHub username
echo ""
echo -e "${YELLOW}Please enter your GitHub username:${NC}"
read -p "GitHub username: " GITHUB_USER

if [ -z "$GITHUB_USER" ]; then
    echo -e "${RED}❌ GitHub username is required${NC}"
    exit 1
fi

# Confirm repository name
REPO_NAME="darklock-guard"
echo ""
echo -e "${YELLOW}Repository name will be: ${GREEN}$REPO_NAME${NC}"
read -p "Press Enter to continue or type a different name: " CUSTOM_REPO

if [ -n "$CUSTOM_REPO" ]; then
    REPO_NAME="$CUSTOM_REPO"
fi

# Check if remote already exists
if git remote get-url origin &> /dev/null; then
    CURRENT_REMOTE=$(git remote get-url origin)
    echo -e "${YELLOW}⚠️  Remote 'origin' already exists: $CURRENT_REMOTE${NC}"
    read -p "Remove and replace with new remote? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git remote remove origin
        echo -e "${GREEN}✓ Removed old remote${NC}"
    fi
fi

# Add remote if it doesn't exist
if ! git remote get-url origin &> /dev/null; then
    REPO_URL="https://github.com/$GITHUB_USER/$REPO_NAME.git"
    echo -e "${YELLOW}📡 Adding remote: $REPO_URL${NC}"
    git remote add origin "$REPO_URL"
    echo -e "${GREEN}✓ Remote added${NC}"
fi

# Stage all files
echo ""
echo -e "${YELLOW}📦 Staging files...${NC}"
git add .

# Show status
echo ""
echo -e "${YELLOW}📊 Git status:${NC}"
git status --short

# Confirm before committing
echo ""
read -p "Create initial commit and push? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Setup complete. You can commit and push manually when ready."
    exit 0
fi

# Create initial commit if there are changes
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
    echo -e "${YELLOW}💾 Creating initial commit...${NC}"
    git commit -m "Initial commit: Darklock Guard v0.1.0

- Enterprise-grade security & device protection suite
- Tauri-based desktop application  
- React + TypeScript frontend
- Rust backend with guard-core, guard-service, and updater-helper
- Zero-trust security model
- File integrity monitoring with HMAC verification
- Encrypted vault system
- Real-time event logging and monitoring"
    echo -e "${GREEN}✓ Initial commit created${NC}"
else
    echo -e "${GREEN}✓ No changes to commit${NC}"
fi

# Set main branch
echo -e "${YELLOW}🌿 Setting main branch...${NC}"
git branch -M main

# Push to GitHub
echo ""
echo -e "${YELLOW}🚀 Pushing to GitHub...${NC}"
echo "   Repository: https://github.com/$GITHUB_USER/$REPO_NAME"
echo ""

if git push -u origin main; then
    echo ""
    echo -e "${GREEN}✅ Success! Your repository is now on GitHub!${NC}"
    echo ""
    echo "🔗 Repository URL: https://github.com/$GITHUB_USER/$REPO_NAME"
    echo ""
    echo "📋 Next steps:"
    echo "   1. Visit your repository on GitHub"
    echo "   2. Add a description and topics in repository settings"
    echo "   3. Enable Issues and Discussions"
    echo "   4. Create your first release (see GITHUB_SETUP_GUIDE.md)"
    echo ""
else
    echo ""
    echo -e "${RED}❌ Failed to push to GitHub${NC}"
    echo ""
    echo "Common issues:"
    echo "  - Repository doesn't exist on GitHub (create it first at https://github.com/new)"
    echo "  - Authentication failed (set up SSH keys or personal access token)"
    echo "  - Branch protection rules"
    echo ""
    echo "Try pushing manually with: git push -u origin main"
fi
