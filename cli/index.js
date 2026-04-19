#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const EXIT_CODES = {
    SUCCESS: 0,
    VALIDATION_FAILED: 1,
    NO_STAGED_FILES: 2,
    CONFIG_ERROR: 3,
    TOOL_MISSING: 4,
};

const DEFAULT_CONFIG = {
    strict: true,
    enableAutoOnCommit: false,
    python: {
        runPylint: 'error',
        runFlake8: 'error',
        runBlack: 'error',
        runIsort: 'error',
        runMypy: 'warning',
        runBandit: 'error',
        enforceNaming: 'error',
        enforceDocstrings: 'warning',
    },
    csharp: {
        runRoslyn: 'error',
        runStyleCop: 'error',
        runSonarAnalyzer: 'error',
        runDotnetFormat: 'error',
        enforceNaming: 'error',
    },
    analysis: {
        enableAstAnalysis: true,
        enableSemanticAnalysis: true,
        enableImpactAnalysis: true,
    },
};

function loadConfig(workspaceRoot) {
    const configPaths = [
        path.join(workspaceRoot, '.code-quality', 'config.json'),
        path.join(workspaceRoot, 'code-quality.config.json'),
    ];

    for (const configPath of configPaths) {
        if (fs.existsSync(configPath)) {
            try {
                const content = fs.readFileSync(configPath, 'utf-8');
                return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
            } catch (e) {
                console.error('Failed to load config:', e.message);
            }
        }
    }
    return DEFAULT_CONFIG;
}

function getStagedFiles(workspaceRoot) {
    try {
        const result = execSync('git diff --cached --name-status', {
            cwd: workspaceRoot,
            encoding: 'utf-8',
        });

        const files = [];
        const lines = result.trim().split('\n').filter(l => l.trim());

        for (const line of lines) {
            const parts = line.split('\t');
            if (parts.length < 2) continue;

            const statusChar = parts[0][0];
            const filePath = parts[1];

            let status = 'modified';
            if (statusChar === 'A') status = 'added';
            else if (statusChar === 'M') status = 'modified';
            else if (statusChar === 'D') status = 'deleted';
            else if (statusChar === 'R') status = 'renamed';

            let language = 'unknown';
            if (filePath.endsWith('.py')) language = 'python';
            else if (filePath.endsWith('.cs')) language = 'csharp';

            files.push({ path: filePath, status, language });
        }
        return files;
    } catch (e) {
        console.error('Failed to get staged files:', e.message);
        return [];
    }
}

function runPylint(files, workspaceRoot) {
    const pyFiles = files.filter(f => f.language === 'python').map(f => f.path);
    if (pyFiles.length === 0) return { success: true, errors: [], warnings: [] };

    try {
        execSync(`pylint --output-format=text ${pyFiles.map(f => '"' + f + '"').join(' ')}`, {
            cwd: workspaceRoot,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
        });
        return { success: true, errors: [], warnings: [] };
    } catch (e) {
        return { success: false, errors: [{ line: 1, message: 'Pylint found issues' }], warnings: [] };
    }
}

function runFlake8(files, workspaceRoot) {
    const pyFiles = files.filter(f => f.language === 'python').map(f => f.path);
    if (pyFiles.length === 0) return { success: true, errors: [], warnings: [] };

    try {
        execSync(`flake8 ${pyFiles.map(f => '"' + f + '"').join(' ')}`, {
            cwd: workspaceRoot,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
        });
        return { success: true, errors: [], warnings: [] };
    } catch (e) {
        return { success: false, errors: [{ line: 1, message: 'Flake8 found issues' }], warnings: [] };
    }
}

function runBlack(files, workspaceRoot) {
    const pyFiles = files.filter(f => f.language === 'python').map(f => f.path);
    if (pyFiles.length === 0) return { success: true, errors: [], warnings: [] };

    try {
        execSync(`black --check ${pyFiles.map(f => '"' + f + '"').join(' ')}`, {
            cwd: workspaceRoot,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
        });
        return { success: true, errors: [], warnings: [] };
    } catch (e) {
        return { success: false, errors: [{ line: 1, message: 'Black: formatting needed' }], warnings: [] };
    }
}

function runIsort(files, workspaceRoot) {
    const pyFiles = files.filter(f => f.language === 'python').map(f => f.path);
    if (pyFiles.length === 0) return { success: true, errors: [], warnings: [] };

    try {
        execSync(`isort --check-only ${pyFiles.map(f => '"' + f + '"').join(' ')}`, {
            cwd: workspaceRoot,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
        });
        return { success: true, errors: [], warnings: [] };
    } catch (e) {
        return { success: false, errors: [{ line: 1, message: 'isort: import order needs fixing' }], warnings: [] };
    }
}

function runMypy(files, workspaceRoot) {
    const pyFiles = files.filter(f => f.language === 'python').map(f => f.path);
    if (pyFiles.length === 0) return { success: true, errors: [], warnings: [] };

    try {
        execSync(`mypy ${pyFiles.map(f => '"' + f + '"').join(' ')}`, {
            cwd: workspaceRoot,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
        });
        return { success: true, errors: [], warnings: [] };
    } catch (e) {
        return { success: true, errors: [], warnings: [{ line: 1, message: 'MyPy warnings' }] };
    }
}

function runBandit(files, workspaceRoot) {
    const pyFiles = files.filter(f => f.language === 'python').map(f => f.path);
    if (pyFiles.length === 0) return { success: true, errors: [], warnings: [] };

    try {
        execSync(`bandit -r ${pyFiles.map(f => '"' + f + '"').join(' ')}`, {
            cwd: workspaceRoot,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
        });
        return { success: true, errors: [], warnings: [] };
    } catch (e) {
        return { success: false, errors: [{ line: 1, message: 'Bandit: security issues found' }], warnings: [] };
    }
}

function runDotnetBuild(files, workspaceRoot) {
    const csFiles = files.filter(f => f.language === 'csharp');
    if (csFiles.length === 0) return { success: true, errors: [], warnings: [] };

    try {
        const csprojFiles = fs.readdirSync(workspaceRoot).filter(f => f.endsWith('.csproj'));
        if (csprojFiles.length === 0) {
            return { success: false, errors: [{ line: 0, message: 'No .csproj found' }], warnings: [] };
        }

        execSync('dotnet build ' + csprojFiles[0] + ' --no-incremental --verbosity quiet', {
            cwd: workspaceRoot,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1' },
        });
        return { success: true, errors: [], warnings: [] };
    } catch (e) {
        return { success: false, errors: [{ line: 0, message: 'Build failed' }], warnings: [] };
    }
}

function runDotnetFormat(files, workspaceRoot) {
    const csFiles = files.filter(f => f.language === 'csharp');
    if (csFiles.length === 0) return { success: true, errors: [], warnings: [] };

    try {
        const csprojFiles = fs.readdirSync(workspaceRoot).filter(f => f.endsWith('.csproj'));
        if (csprojFiles.length === 0) return { success: true, errors: [], warnings: [] };

        execSync('dotnet format ' + csprojFiles[0] + ' --verify-no-changes', {
            cwd: workspaceRoot,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1' },
        });
        return { success: true, errors: [], warnings: [] };
    } catch (e) {
        return { success: false, errors: [{ line: 1, message: 'dotnet format: formatting needed' }], warnings: [] };
    }
}

function checkNamingConventions(files, workspaceRoot, language) {
    const errors = [];
    const warnings = [];

    for (const file of files) {
        if (file.language !== language) continue;

        const filePath = path.join(workspaceRoot, file.path);
        if (!fs.existsSync(filePath)) continue;

        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const lineNum = i + 1;

                if (language === 'python') {
                    const classMatch = line.match(/^class\s+(\w+)/);
                    if (classMatch && !/^[A-Z][a-zA-Z0-9]*$/.test(classMatch[1])) {
                        errors.push({ line: lineNum, message: 'Class should use PascalCase', code: 'NAMING001' });
                    }

                    const funcMatch = line.match(/^\s*def\s+(\w+)/);
                    if (funcMatch && !/^[a-z_][a-z0-9_]*$/.test(funcMatch[1])) {
                        errors.push({ line: lineNum, message: 'Function should use snake_case', code: 'NAMING002' });
                    }
                } else if (language === 'csharp') {
                    const classMatch = line.match(/^(public|internal)?\s*(class|interface|struct)\s+(\w+)/);
                    if (classMatch) {
                        const name = classMatch[3];
                        if (!/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
                            errors.push({ line: lineNum, message: 'Type should use PascalCase', code: 'NAMING010' });
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Naming check failed:', e.message);
        }
    }

    return { success: errors.length === 0, errors, warnings };
}

async function runAnalysis(files, workspaceRoot, config) {
    const startTime = Date.now();
    const allErrors = [];
    const allWarnings = [];

    const hasPython = files.some(f => f.language === 'python');
    const hasCSharp = files.some(f => f.language === 'csharp');

    if (hasPython) {
        if (config.python.runPylint !== 'off') allErrors.push(...runPylint(files, workspaceRoot).errors);
        if (config.python.runFlake8 !== 'off') allErrors.push(...runFlake8(files, workspaceRoot).errors);
        if (config.python.runBlack !== 'off') allErrors.push(...runBlack(files, workspaceRoot).errors);
        if (config.python.runIsort !== 'off') allErrors.push(...runIsort(files, workspaceRoot).errors);
        if (config.python.runMypy !== 'off') allWarnings.push(...runMypy(files, workspaceRoot).warnings);
        if (config.python.runBandit !== 'off') allErrors.push(...runBandit(files, workspaceRoot).errors);
        if (config.python.enforceNaming !== 'off') allErrors.push(...checkNamingConventions(files, workspaceRoot, 'python').errors);
    }

    if (hasCSharp) {
        if (config.csharp.runRoslyn !== 'off') allErrors.push(...runDotnetBuild(files, workspaceRoot).errors);
        if (config.csharp.runDotnetFormat !== 'off') allErrors.push(...runDotnetFormat(files, workspaceRoot).errors);
        if (config.csharp.enforceNaming !== 'off') allErrors.push(...checkNamingConventions(files, workspaceRoot, 'csharp').errors);
    }

    return {
        allErrors,
        allWarnings,
        executionTime: Date.now() - startTime,
        success: allErrors.length === 0,
    };
}

function findWorkspaceRoot() {
    let cwd = process.cwd();

    const searchDirs = (dir) => {
        if (fs.existsSync(path.join(dir, '.git'))) {
            return dir;
        }
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        return searchDirs(parent);
    };

    const gitRoot = searchDirs(cwd);
    if (gitRoot) return gitRoot;

    if (fs.existsSync(path.join(cwd, '.csproj'))) return cwd;
    if (fs.existsSync(path.join(cwd, 'pyproject.toml'))) return cwd;

    const pyFiles = fs.readdirSync(cwd).filter(f => f.endsWith('.csproj'));
    if (pyFiles.length > 0) return cwd;

    return cwd;
}

function main() {
    const args = process.argv;
    const options = { staged: false, hook: false, verbose: false };

    for (let i = 2; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--staged' || arg === '-s') options.staged = true;
        else if (arg === '--hook') options.hook = true;
        else if (arg === '--verbose' || arg === '-v') options.verbose = true;
    }

    console.log('Code Quality Guardian CLI');

    const workspaceRoot = findWorkspaceRoot();
    console.log('Workspace:', workspaceRoot);

    const config = loadConfig(workspaceRoot);
    let files = getStagedFiles(workspaceRoot);

    if (!options.staged || files.length === 0) {
        console.log('No staged files - exiting');
        process.exit(EXIT_CODES.SUCCESS);
    }

    console.log('Staged files:', files.length);

    const result = runAnalysis(files, workspaceRoot, config);

    if (result.allErrors.length > 0) {
        console.log('');
        console.log('VALIDATION FAILED');
        console.log('='.repeat(30));
        console.log('Found', result.allErrors.length, 'errors:');
        
        const grouped = {};
        for (const err of result.allErrors) {
            const key = err.line + ':' + err.message;
            grouped[key] = (grouped[key] || 0) + 1;
        }
        
        for (const key in grouped) {
            console.log('  -', key, '(' + grouped[key] + 'x)');
        }
        
        console.log('');
        console.log('COMMIT BLOCKED');
        process.exit(config.strict ? EXIT_CODES.VALIDATION_FAILED : EXIT_CODES.SUCCESS);
    }

    console.log('');
    console.log('All checks passed!');
    console.log('Execution time:', result.executionTime, 'ms');
    
    process.exit(EXIT_CODES.SUCCESS);
}

if (require.main === module) {
    main();
}

module.exports = { runAnalysis, getStagedFiles, loadConfig };