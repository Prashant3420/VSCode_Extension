#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

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
                console.error(`Failed to load config from ${configPath}:`, e.message);
            }
        }
    }

    return DEFAULT_CONFIG;
}

function getStagedFiles(workspaceRoot) {
    try {
        const { execSync } = require('child_process');
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

function detectLanguage(files) {
    const pythonCount = files.filter(f => f.language === 'python').length;
    const csharpCount = files.filter(f => f.language === 'csharp').length;

    if (pythonCount > 0 && csharpCount > 0) return 'mixed';
    if (pythonCount > 0) return 'python';
    if (csharpCount > 0) return 'csharp';
    return 'unknown';
}

function runPylint(files, workspaceRoot) {
    const pyFiles = files.filter(f => f.language === 'python').map(f => f.path);
    if (pyFiles.length === 0) return { success: true, errors: [], warnings: [] };

    try {
        const { execSync } = require('child_process');
        const result = execSync(`pylint --output-format=text ${pyFiles.map(f => `"${f}"`).join(' ')}`, {
            cwd: workspaceRoot,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
        });

        const errors = parsePylintOutput(result);
        return { success: errors.length === 0, errors, warnings: [] };
    } catch (e) {
        if (e.stdout) {
            const errors = parsePylintOutput(e.stdout.toString());
            return { success: false, errors, warnings: [] };
        }
        return { success: false, errors: [{ line: 0, message: e.message }], warnings: [] };
    }
}

function parsePylintOutput(output) {
    const errors = [];
    const lines = output.split('\n');

    for (const line of lines) {
        const match = line.match(/(\S+):(\d+):(\d+):\s*(\w+):\s*(.+)/);
        if (match) {
            const [, file, lineNum, col, code, message] = match;
            errors.push({
                line: parseInt(lineNum),
                column: parseInt(col),
                message: message.trim(),
                code: code,
                severity: code.startsWith('E') ? 'error' : 'warning',
            });
        }
    }

    return errors;
}

function runFlake8(files, workspaceRoot) {
    const pyFiles = files.filter(f => f.language === 'python').map(f => f.path);
    if (pyFiles.length === 0) return { success: true, errors: [], warnings: [] };

    try {
        const { execSync } = require('child_process');
        const result = execSync(`flake8 ${pyFiles.map(f => `"${f}"`).join(' ')}`, {
            cwd: workspaceRoot,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
        });

        const errors = parseFlake8Output(result);
        return { success: errors.length === 0, errors, warnings: [] };
    } catch (e) {
        if (e.stdout) {
            const errors = parseFlake8Output(e.stdout.toString());
            return { success: false, errors, warnings: [] };
        }
        return { success: false, errors: [], warnings: [] };
    }
}

function parseFlake8Output(output) {
    const errors = [];
    const lines = output.split('\n');

    for (const line of lines) {
        const match = line.match(/(.+):(\d+):(\d+):\s*(\w+)\s+(.+)/);
        if (match) {
            const [, file, lineNum, col, code, message] = match;
            const severity = code.startsWith('E') || code.startsWith('F') ? 'error' : 'warning';
            errors.push({
                line: parseInt(lineNum),
                column: parseInt(col),
                message: message.trim(),
                code: code,
                severity,
            });
        }
    }

    return errors;
}

function runBlack(files, workspaceRoot) {
    const pyFiles = files.filter(f => f.language === 'python').map(f => f.path);
    if (pyFiles.length === 0) return { success: true, errors: [], warnings: [] };

    try {
        const { execSync } = require('child_process');
        execSync(`black --check ${pyFiles.map(f => `"${f}"`).join(' ')}`, {
            cwd: workspaceRoot,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
        });

        return { success: true, errors: [], warnings: [] };
    } catch (e) {
        return {
            success: false,
            errors: [{ line: 1, message: 'File needs formatting (run black)', code: 'BLACK001', severity: 'error' }],
            warnings: [],
        };
    }
}

function runIsort(files, workspaceRoot) {
    const pyFiles = files.filter(f => f.language === 'python').map(f => f.path);
    if (pyFiles.length === 0) return { success: true, errors: [], warnings: [] };

    try {
        const { execSync } = require('child_process');
        execSync(`isort --check-only ${pyFiles.map(f => `"${f}"`).join(' ')}`, {
            cwd: workspaceRoot,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
        });

        return { success: true, errors: [], warnings: [] };
    } catch (e) {
        return {
            success: false,
            errors: [{ line: 1, message: 'Import order needs fixing (run isort)', code: 'ISORT001', severity: 'error' }],
            warnings: [],
        };
    }
}

function runMypy(files, workspaceRoot) {
    const pyFiles = files.filter(f => f.language === 'python').map(f => f.path);
    if (pyFiles.length === 0) return { success: true, errors: [], warnings: [] };

    try {
        const { execSync } = require('child_process');
        execSync(`mypy ${pyFiles.map(f => `"${f}"`).join(' ')}`, {
            cwd: workspaceRoot,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
        });

        return { success: true, errors: [], warnings: [] };
    } catch (e) {
        if (e.stdout) {
            const output = e.stdout.toString();
            const lines = output.split('\n').filter(l => l.includes(': error:') || l.includes(': warning:'));
            const errors = [];
            const warnings = [];

            for (const line of lines) {
                const match = line.match(/(.+):(\d+):\s*(error|warning):\s*(.+)/);
                if (match) {
                    const [, file, lineNum, type, message] = match;
                    const error = {
                        line: parseInt(lineNum),
                        message: message.trim(),
                        severity: type === 'error' ? 'error' : 'warning',
                    };

                    if (type === 'error') errors.push(error);
                    else warnings.push(error);
                }
            }

            return { success: errors.length === 0, errors, warnings };
        }
        return { success: true, errors: [], warnings: [] };
    }
}

function runBandit(files, workspaceRoot) {
    const pyFiles = files.filter(f => f.language === 'python').map(f => f.path);
    if (pyFiles.length === 0) return { success: true, errors: [], warnings: [] };

    try {
        const { execSync } = require('child_process');
        execSync(`bandit -r ${pyFiles.map(f => `"${f}"`).join(' ')}`, {
            cwd: workspaceRoot,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
        });

        return { success: true, errors: [], warnings: [] };
    } catch (e) {
        if (e.stdout) {
            const output = e.stdout.toString();
            const lines = output.split('\n').filter(l => l.includes(':'), []);
            const errors = [];

            for (const line of lines) {
                const match = line.match(/(.+):(\d+):\s*(\w+):\s*(.+)/);
                if (match) {
                    errors.push({
                        line: parseInt(match[2]),
                        message: `[SECURITY] ${match[4].trim()}`,
                        code: match[3],
                        severity: 'error',
                    });
                }
            }

            return { success: errors.length === 0, errors, warnings: [] };
        }
        return { success: true, errors: [], warnings: [] };
    }
}

function runDotnetBuild(files, workspaceRoot) {
    const csFiles = files.filter(f => f.language === 'csharp');
    if (csFiles.length === 0) return { success: true, errors: [], warnings: [] };

    try {
        const csprojFiles = fs.readdirSync(workspaceRoot).filter(f => f.endsWith('.csproj'));
        if (csprojFiles.length === 0) {
            return {
                success: false,
                errors: [{ line: 0, message: 'No .csproj file found', code: 'CSHARP001', severity: 'error' }],
                warnings: [],
            };
        }

        const { execSync } = require('child_process');
        execSync(`dotnet build ${csprojFiles[0]} --no-incremental --verbosity quiet`, {
            cwd: workspaceRoot,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1' },
        });

        return { success: true, errors: [], warnings: [] };
    } catch (e) {
        const output = e.stdout?.toString() || e.message || '';
        const errors = parseDotnetOutput(output);
        return { success: errors.length === 0, errors, warnings: [] };
    }
}

function parseDotnetOutput(output) {
    const errors = [];
    const lines = output.split('\n');

    for (const line of lines) {
        const match = line.match(/(\S+\.cs)\((\d+),(\d+)\):\s*(\w+)\s+(CS\d+):\s*(.+)/);
        if (match) {
            errors.push({
                line: parseInt(match[2]),
                column: parseInt(match[3]),
                message: match[6].trim(),
                code: match[5],
                severity: match[4].toLowerCase().includes('error') ? 'error' : 'warning',
            });
        }
    }

    return errors;
}

function runDotnetFormat(files, workspaceRoot) {
    const csFiles = files.filter(f => f.language === 'csharp');
    if (csFiles.length === 0) return { success: true, errors: [], warnings: [] };

    try {
        const csprojFiles = fs.readdirSync(workspaceRoot).filter(f => f.endsWith('.csproj'));
        if (csprojFiles.length === 0) {
            return { success: true, errors: [], warnings: [] };
        }

        const { execSync } = require('child_process');
        execSync(`dotnet format ${csprojFiles[0]} --verify-no-changes`, {
            cwd: workspaceRoot,
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
            env: { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1' },
        });

        return { success: true, errors: [], warnings: [] };
    } catch (e) {
        const output = e.stdout?.toString() || e.stderr?.toString() || e.message || '';
        if (output.includes('would format')) {
            return {
                success: false,
                errors: [{ line: 1, message: 'Code needs formatting (run dotnet format)', code: 'FORMAT001', severity: 'error' }],
                warnings: [],
            };
        }
        return { success: true, errors: [], warnings: [] };
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
                        errors.push({
                            line: lineNum,
                            message: `Class "${classMatch[1]}" should use PascalCase`,
                            code: 'NAMING001',
                            severity: 'error',
                        });
                    }

                    const funcMatch = line.match(/^\s*def\s+(\w+)/);
                    if (funcMatch && !/^[a-z_][a-z0-9_]*$/.test(funcMatch[1])) {
                        errors.push({
                            line: lineNum,
                            message: `Function "${funcMatch[1]}" should use snake_case`,
                            code: 'NAMING002',
                            severity: 'error',
                        });
                    }
                } else if (language === 'csharp') {
                    const classMatch = line.match(/^(public|internal)?\s*(class|interface|struct)\s+(\w+)/);
                    if (classMatch) {
                        const name = classMatch[3];
                        if (!/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
                            errors.push({
                                line: lineNum,
                                message: `Type "${name}" should use PascalCase`,
                                code: 'NAMING010',
                                severity: 'error',
                            });
                        }
                    }

                    const methodMatch = line.match(/^(public|private|protected|internal)\s+(\w+)\s+(\w+)\s*\(/);
                    if (methodMatch) {
                        const name = methodMatch[3];
                        if (!/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
                            errors.push({
                                line: lineNum,
                                message: `Method "${name}" should use PascalCase`,
                                code: 'NAMING011',
                                severity: 'error',
                            });
                        }
                    }
                }
            }
        } catch (e) {
            console.error(`Failed to check naming in ${file.path}:`, e.message);
        }
    }

    return { success: errors.length === 0, errors, warnings };
}

async function runAnalysis(files, workspaceRoot, config) {
    const startTime = Date.now();
    const allErrors = [];
    const allWarnings = [];

    const language = detectLanguage(files);

    if (language === 'python' || language === 'mixed') {
        const pyFiles = files.filter(f => f.language === 'python');

        if (config.python.runPylint !== 'off') {
            const result = runPylint(files, workspaceRoot);
            allErrors.push(...result.errors.map(e => ({ ...e, tool: 'pylint' })));
            allWarnings.push(...result.warnings.map(w => ({ ...w, tool: 'pylint' })));
            if (!result.success && config.python.runPylint === 'error') {
                console.error('Pylint failed');
            }
        }

        if (config.python.runFlake8 !== 'off') {
            const result = runFlake8(files, workspaceRoot);
            allErrors.push(...result.errors.map(e => ({ ...e, tool: 'flake8' })));
            allWarnings.push(...result.warnings.map(w => ({ ...w, tool: 'flake8' })));
            if (!result.success && config.python.runFlake8 === 'error') {
                console.error('Flake8 failed');
            }
        }

        if (config.python.runBlack !== 'off') {
            const result = runBlack(files, workspaceRoot);
            allErrors.push(...result.errors.map(e => ({ ...e, tool: 'black' })));
            allWarnings.push(...result.warnings.map(w => ({ ...w, tool: 'black' })));
            if (!result.success && config.python.runBlack === 'error') {
                console.error('Black failed');
            }
        }

        if (config.python.runIsort !== 'off') {
            const result = runIsort(files, workspaceRoot);
            allErrors.push(...result.errors.map(e => ({ ...e, tool: 'isort' })));
            allWarnings.push(...result.warnings.map(w => ({ ...w, tool: 'isort' })));
            if (!result.success && config.python.runIsort === 'error') {
                console.error('isort failed');
            }
        }

        if (config.python.runMypy !== 'off') {
            const result = runMypy(files, workspaceRoot);
            allErrors.push(...result.errors.map(e => ({ ...e, tool: 'mypy' })));
            allWarnings.push(...result.warnings.map(w => ({ ...w, tool: 'mypy' })));
            if (!result.success && config.python.runMypy === 'error') {
                console.error('MyPy failed');
            }
        }

        if (config.python.runBandit !== 'off') {
            const result = runBandit(files, workspaceRoot);
            allErrors.push(...result.errors.map(e => ({ ...e, tool: 'bandit' })));
            allWarnings.push(...result.warnings.map(w => ({ ...w, tool: 'bandit' })));
            if (!result.success && config.python.runBandit === 'error') {
                console.error('Bandit failed');
            }
        }

        if (config.python.enforceNaming !== 'off') {
            const result = checkNamingConventions(files, workspaceRoot, 'python');
            allErrors.push(...result.errors.map(e => ({ ...e, tool: 'naming' })));
            allWarnings.push(...result.warnings.map(w => ({ ...w, tool: 'naming' })));
            if (!result.success && config.python.enforceNaming === 'error') {
                console.error('Naming conventions check failed');
            }
        }
    }

    if (language === 'csharp' || language === 'mixed') {
        if (config.csharp.runRoslyn !== 'off') {
            const result = runDotnetBuild(files, workspaceRoot);
            allErrors.push(...result.errors.map(e => ({ ...e, tool: 'roslyn' })));
            allWarnings.push(...result.warnings.map(w => ({ ...w, tool: 'roslyn' })));
            if (!result.success && config.csharp.runRoslyn === 'error') {
                console.error('Roslyn build failed');
            }
        }

        if (config.csharp.runDotnetFormat !== 'off') {
            const result = runDotnetFormat(files, workspaceRoot);
            allErrors.push(...result.errors.map(e => ({ ...e, tool: 'dotnet-format' })));
            allWarnings.push(...result.warnings.map(w => ({ ...w, tool: 'dotnet-format' })));
            if (!result.success && config.csharp.runDotnetFormat === 'error') {
                console.error('dotnet format failed');
            }
        }

        if (config.csharp.enforceNaming !== 'off') {
            const result = checkNamingConventions(files, workspaceRoot, 'csharp');
            allErrors.push(...result.errors.map(e => ({ ...e, tool: 'naming' })));
            allWarnings.push(...result.warnings.map(w => ({ ...w, tool: 'naming' })));
            if (!result.success && config.csharp.enforceNaming === 'error') {
                console.error('C# naming conventions failed');
            }
        }
    }

    const executionTime = Date.now() - startTime;

    return {
        allErrors,
        allWarnings,
        executionTime,
        success: allErrors.length === 0,
    };
}

function parseArgs(args) {
    const options = {
        staged: false,
        hook: false,
        verbose: false,
    };

    for (let i = 2; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--staged' || arg === '-s') {
            options.staged = true;
        } else if (arg === '--hook') {
            options.hook = true;
        } else if (arg === '--verbose' || arg === '-v') {
            options.verbose = true;
        }
    }

    return options;
}

async function main() {
    const args = process.argv;
    const options = parseArgs(args);

    if (options.verbose) {
        console.log('Code Quality Guardian CLI');
        console.log('====================');
    }

    const workspaceRoot = findWorkspaceRoot();

    if (!workspaceRoot) {
        console.error('Error: No workspace root found');
        process.exit(EXIT_CODES.CONFIG_ERROR);
    }

    if (options.verbose) {
        console.log(`Workspace: ${workspaceRoot}`);
    }

    const config = loadConfig(workspaceRoot);

    let files = getStagedFiles(workspaceRoot);

    if (options.staged !== true || files.length === 0) {
        if (options.verbose) {
            console.log('No staged files');
        }
        process.exit(EXIT_CODES.SUCCESS);
    }

    if (options.verbose) {
        console.log(`Staged files: ${files.length}`);
    }

    const result = await runAnalysis(files, workspaceRoot, config);

    if (result.allErrors.length > 0) {
        console.error('');
        console.error('Validation Failed');
        console.error('=================');
        console.error(`Found ${result.allErrors.length} errors:`);

        const grouped = new Map();
        for (const error of result.allErrors) {
            if (!grouped.has(error.file)) {
                grouped.set(error.file, []);
            }
            grouped.get(error.file).push(error);
        }

        for (const [file, errors] of grouped) {
            console.error(`\n${file}:`);
            for (const error of errors.slice(0, 5)) {
                console.error(`  L${error.line}: ${error.message}`);
                if (error.code) {
                    console.error(`    [${error.code}]`);
                }
            }
            if (errors.length > 5) {
                console.error(`  ... and ${errors.length - 5} more errors`);
            }
        }

        if (options.hook || options.verbose) {
            console.error(`\nExecution time: ${result.executionTime}ms`);
        }
    } else {
        if (options.verbose) {
            console.log('');
            console.log('All checks passed!');
            console.log(`Execution time: ${result.executionTime}ms`);
        }
    }

    if (result.allWarnings.length > 0 && options.verbose) {
        console.warn(`\nWarnings: ${result.allWarnings.length}`);
    }

    process.exit(config.strict ? (result.success ? EXIT_CODES.SUCCESS : EXIT_CODES.VALIDATION_FAILED) : EXIT_CODES.SUCCESS);
}

function findWorkspaceRoot() {
    let cwd = process.cwd();

    const searchDirs = (dir) => {
        if (fs.existsSync(path.join(dir, '.git'))) {
            return dir;
        }

        const parent = path.dirname(dir);
        if (parent === dir) {
            return null;
        }

        return searchDirs(parent);
    };

    const gitRoot = searchDirs(cwd);

    if (gitRoot) {
        return gitRoot;
    }

    if (fs.existsSync(path.join(cwd, '.csproj')) {
        return cwd;
    }

    if (fs.existsSync(path.join(cwd, 'pyproject.toml'))) {
        return cwd;
    }

    const pyprojectFiles = fs.readdirSync(cwd).filter(f => f.endsWith('.csproj'));
    if (pyprojectFiles.length > 0) {
        return cwd;
    }

    return cwd;
}

if (require.main === module) {
    main().catch(e => {
        console.error('Unexpected error:', e.message);
        process.exit(EXIT_CODES.VALIDATION_FAILED);
    });
}

module.exports = { runAnalysis, getStagedFiles, loadConfig };