# Code Quality Guardian

A production-grade VS Code extension and CLI for pre-commit code quality enforcement in Python and C# projects.

## Features

- **3-Layer Analysis System**:
  - **Layer 1 (Lint)**: Pylint, Flake8, Black, isort, MyPy, Bandit for Python; Roslyn, StyleCop, SonarAnalyzer, dotnet format for C#
  - **Layer 2 (AST)**: Deep AST-based analysis to detect dead code, unused imports, anti-patterns
  - **Layer 3 (Semantic)**: Cross-file reference validation, dependency pattern enforcement

- **Codebase Intelligence**:
  - Scans entire codebase to learn naming conventions and architecture patterns
  - Validates staged changes against the learned project profile

- **Diff Impact Analysis**:
  - Detects signature changes and breaking changes
  - Identifies ripple effects of staged changes

- **Strict Mode**: Blocks commits on ANY violation (enabled by default)

- **Git Pre-commit Hook Integration**:
  - Manual hook installation (`code-quality.installHook`)
  - Optional auto-install on project open
  - Proper Git hook that blocks commits on failure

- **Flexible Configuration**:
  - VS Code settings
  - Config file (`.code-quality/config.json`)
  - Per-tool severity control

## Requirements

### For Python Analysis
- Python 3.8+
- One or more of: pylint, flake8, black, isort, mypy, bandit

### For C# Analysis
- .NET 6.0+ SDK
- (Optional) StyleCop.Analyzers
- (Optional) SonarAnalyzer.CSharp

## Installation

### VS Code Extension
1. Open the extension in VS Code
2. Run `npm install`
3. Press F5 to start debugging

### CLI for Pre-commit Hook
```bash
# Install hook manually
./scripts/install-hook.sh

# Or via VS Code command
# 1. Open command palette (Cmd+Shift+P)
# 2. Run "Code Quality: Install Pre-commit Hook"
```

## Usage

### VS Code Commands
- `Code Quality: Install Pre-commit Hook` - Install the Git hook
- `Code Quality: Run Quality Checks` - Run checks on staged files
- `Code Quality: Scan Project` - Build project profile
- `Code Quality: Show Configuration` - View current settings
- `Code Quality: Enable/Disable Auto-check on Commit` - Toggle auto-run

### CLI
```bash
# Run checks on staged files
node cli/index.js --staged

# Run with verbose output
node cli/index.js --staged --verbose

# Run via pre-commit hook
git commit -m "Your commit message"
```

## Configuration

### VS Code Settings
```json
{
  "codeQuality.strict": true,
  "codeQuality.autoInstallHooks": false,
  "codeQuality.enableAutoOnCommit": true,
  "codeQuality.python.runPylint": "error",
  "codeQuality.python.runFlake8": "error",
  "codeQuality.python.runBlack": "error",
  "codeQuality.python.runIsort": "error",
  "codeQuality.python.runMypy": "warning",
  "codeQuality.python.runBandit": "error",
  "codeQuality.python.enforceNaming": "error",
  "codeQuality.python.enforceDocstrings": "warning",
  "codeQuality.csharp.runRoslyn": "error",
  "codeQuality.csharp.runStyleCop": "error",
  "codeQuality.csharp.runSonarAnalyzer": "error",
  "codeQuality.csharp.runDotnetFormat": "error",
  "codeQuality.csharp.enforceNaming": "error",
  "codeQuality.analysis.enableAstAnalysis": true,
  "codeQuality.analysis.enableSemanticAnalysis": true,
  "codeQuality.analysis.enableImpactAnalysis": true
}
```

### Config File (`.code-quality/config.json`)
```json
{
  "strict": true,
  "autoInstallHooks": false,
  "python": {
    "runPylint": "error",
    "runFlake8": "error",
    "runBlack": "error",
    "runIsort": "error",
    "runMypy": "warning",
    "runBandit": "error",
    "enforceNaming": "error",
    "enforceDocstrings": "warning"
  },
  "csharp": {
    "runRoslyn": "error",
    "runStyleCop": "error",
    "runSonarAnalyzer": "error",
    "runDotnetFormat": "error",
    "enforceNaming": "error"
  },
  "analysis": {
    "enableAstAnalysis": true,
    "enableSemanticAnalysis": true,
    "enableImpactAnalysis": true
  }
}
```

## Supported Tools

### Python
| Tool | Purpose | Default |
|------|---------|---------|
| Pylint | General linting | error |
| Flake8 | PEP 8 + style | error |
| Black | Formatting | error |
| isort | Import sorting | error |
| MyPy | Type checking | warning |
| Bandit | Security | error |

### C#
| Tool | Purpose | Default |
|------|---------|---------|
| Roslyn | Build + analysis | error |
| StyleCop | Style guidelines | error |
| SonarAnalyzer | Bugs + vulnerabilities | error |
| dotnet format | Formatting | error |

## Project Structure

```
VSCode_Extension/
├── src/
│   ├── extension.ts           # Main VS Code entry
│   ├── git/
│   │   └── gitIntegration.ts # Git API + hook management
│   ├── scanner/
│   │   └── codebaseScanner.ts # Project profile builder
│   ├── analyzer/
│   │   ├── engine.ts         # Analysis orchestration
│   │   ├── lintLayer.ts     # Layer 1: Linting
│   │   ├── astLayer.ts      # Layer 2: AST analysis
│   │   └── semanticLayer.ts # Layer 3: Semantic analysis
│   ├── python/
│   │   └── pythonAnalyzer.ts # Python tool wrappers
│   ├── csharp/
│   │   └── csharpAnalyzer.ts # .NET tool wrappers
│   ├── impact/
│   │   └── diffImpactAnalyzer.ts # Impact analysis
│   ├── diagnostics/
│   │   └── diagnosticsEngine.ts # VS Code diagnostics
│   └── config/
│       └── configManager.ts # Configuration management
├── cli/
│   └── index.js             # CLI for pre-commit hook
├── test/
│   └── extension.test.ts   # Unit tests
├── examples/
│   ├── .editorconfig      # Example .NET config
│   ├── .pylintrc          # Example Python config
│   └── stylecop.json      # Example StyleCop config
└── scripts/
    └── install-hook.sh    # Hook installer
```

## Architecture

### Pre-commit Flow
```
1. User runs: git commit -m "message"
2. Git triggers: .git/hooks/pre-commit
3. Hook runs: node cli/index.js --staged --hook
4. CLI:
   a. Loads project profile (.code-quality/profile.json)
   b. Gets staged files via: git diff --cached --name-only
   c. Runs Layer 1 (linting)
   d. Runs Layer 2 (AST analysis) if Layer 1 passes
   e. Runs Layer 3 (semantic analysis) if Layer 2 passes
   f. Runs Impact Analysis
   g. Validates against project profile
5. IF ANY FAILURE:
   - Output detailed errors
   - Exit code 1 → commit BLOCKED
6. IF ALL PASS:
   - Exit code 0 → commit proceeds
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success - all checks passed |
| 1 | Validation failed - errors found |
| 2 | No staged files to check |
| 3 | Configuration error |
| 4 | Required tool missing |

## Troubleshooting

### Tools not found
Ensure required tools are installed and in your PATH:
```bash
pip install pylint flake8 black isort mypy bandit
# or
dotnet tool install --global dotnet-format
```

### Hook not triggering
Check that the hook is executable:
```bash
chmod +x .git/hooks/pre-commit
```

### Extension not loading
Check the output channel:
- Open VS Code command palette
- Run "Developer: Toggle Developer Tools"
- Check Console for errors

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Create a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details.