#!/bin/bash

# Code Quality Guardian - Pre-commit Hook Installation Script
# This script installs the pre-commit hook for Code Quality Guardian

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
HOOK_DIR="$PROJECT_ROOT/.git/hooks"
HOOK_FILE="$HOOK_DIR/pre-commit"

echo "=============================================="
echo "Code Quality Guardian - Hook Installer"
echo "=============================================="
echo ""

# Check if we're in a git repository
if [ ! -d "$PROJECT_ROOT/.git" ]; then
    echo "Error: Not a git repository (no .git directory found)"
    exit 1
fi

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed"
    exit 1
fi

# Create hooks directory if it doesn't exist
mkdir -p "$HOOK_DIR"

# Check if pre-commit hook already exists
if [ -f "$HOOK_FILE" ]; then
    echo "A pre-commit hook already exists."
    read -p "Do you want to replace it? (y/n): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Installation cancelled."
        exit 0
    fi

    # Backup existing hook
    BACKUP_FILE="$HOOK_FILE.backup.$(date +%Y%m%d%H%M%S)"
    cp "$HOOK_FILE" "$BACKUP_FILE"
    echo "Backed up existing hook to: $BACKUP_FILE"
fi

# Create the pre-commit hook
cat > "$HOOK_FILE" << 'EOF'
#!/bin/bash
# Code Quality Guardian Pre-commit Hook
# This hook is triggered before each commit

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

# Check if CLI exists
if [ -f "$PROJECT_ROOT/cli/index.js" ]; then
    node "$PROJECT_ROOT/cli/index.js" --staged --hook
    exit $?
fi

# Fallback: try npx
if command -v npx &> /dev/null; then
    npx code-quality-guardian --staged --hook
    exit $?
fi

# If no CLI found, skip the check but warn
echo "Warning: Code Quality Guardian CLI not found. Skipping checks."
exit 0
EOF

# Make the hook executable
chmod +x "$HOOK_FILE"

echo ""
echo "✓ Pre-commit hook installed successfully!"
echo "  Location: $HOOK_FILE"
echo ""
echo "The hook will now run code quality checks before each commit."
echo "To uninstall, run: rm .git/hooks/pre-commit"
echo ""
echo "Configuration:"
echo "  - Edit: .code-quality/config.json to customize rules"
echo "  - Run: npx code-quality-guardian --verbose to see detailed output"
echo ""
