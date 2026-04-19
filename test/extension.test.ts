import * as assert from 'assert';

suite('Code Quality Guardian Extension Tests', () => {
    test('ConfigManager should be loadable', async () => {
        try {
            const { ConfigManager } = await import('../src/config/configManager');
            assert.ok(ConfigManager, 'ConfigManager should be exported');
        } catch (e) {
            assert.fail(`Failed to load ConfigManager: ${e}`);
        }
    });

    test('Analyzer module should be loadable', async () => {
        try {
            const { runChecks } = await import('../src/analyzer/engine');
            assert.ok(runChecks, 'runChecks should be exported');
        } catch (e) {
            assert.fail(`Failed to load analyzer: ${e}`);
        }
    });

    test('Python analyzer should be loadable', async () => {
        try {
            const { analyzePython } = await import('../src/python/pythonAnalyzer');
            assert.ok(analyzePython, 'analyzePython should be exported');
        } catch (e) {
            assert.fail(`Failed to load Python analyzer: ${e}`);
        }
    });

    test('C# analyzer should be loadable', async () => {
        try {
            const { analyzeCSharp } = await import('../src/csharp/csharpAnalyzer');
            assert.ok(analyzeCSharp, 'analyzeCSharp should be exported');
        } catch (e) {
            assert.fail(`Failed to load C# analyzer: ${e}`);
        }
    });

    test('Git integration should be loadable', async () => {
        try {
            const { GitIntegration } = await import('../src/git/gitIntegration');
            assert.ok(GitIntegration, 'GitIntegration should be exported');
        } catch (e) {
            assert.fail(`Failed to load Git integration: ${e}`);
        }
    });

    test('Codebase scanner should be loadable', async () => {
        try {
            const { runScan } = await import('../src/scanner/codebaseScanner');
            assert.ok(runScan, 'runScan should be exported');
        } catch (e) {
            assert.fail(`Failed to load scanner: ${e}`);
        }
    });

    test('Diagnostics engine should be loadable', async () => {
        try {
            const { reportDiagnostics } = await import('../src/diagnostics/diagnosticsEngine');
            assert.ok(reportDiagnostics, 'reportDiagnostics should be exported');
        } catch (e) {
            assert.fail(`Failed to load diagnostics: ${e}`);
        }
    });
});

suite('Code Quality Guardian Extension Tests', () => {
    vscode.window.showInformationMessage('Start Code Quality Guardian tests.');

    test('ConfigManager should load default config', () => {
        const configManager = ConfigManager.getInstance();
        const config = configManager.getConfig();

        assert.strictEqual(config.strict, true, 'Strict mode should be enabled by default');
        assert.strictEqual(config.python.runPylint?.level, 'error', 'Pylint should be enabled by default');
    });

    test('ConfigManager should detect Python config', () => {
        const configManager = ConfigManager.getInstance();
        const pythonConfig = configManager.getPythonConfig();

        assert.ok(pythonConfig.runPylint, 'Python config should have runPylint');
    });

    test('ConfigManager should detect C# config', () => {
        const configManager = ConfigManager.getInstance();
        const csharpConfig = configManager.getCSharpConfig();

        assert.ok(csharpConfig.runRoslyn, 'C# config should have runRoslyn');
    });

    test('ConfigManager should detect analysis config', () => {
        const configManager = ConfigManager.getInstance();
        const analysisConfig = configManager.getAnalysisConfig();

        assert.strictEqual(analysisConfig.enableAstAnalysis, true, 'AST analysis should be enabled');
    });

    test('ConfigManager should return workspace root', () => {
        const configManager = ConfigManager.getInstance();
        const workspaceRoot = configManager.getWorkspaceRoot();

        assert.ok(workspaceRoot || workspaceRoot === null, 'getWorkspaceRoot should return a value');
    });
});

suite('Analyzer Engine Tests', () => {
    test('Analyzer module should be loadable', async () => {
        try {
            const { runChecks } = await import('../src/analyzer/engine');
            assert.ok(runChecks, 'runChecks function should be exported');
        } catch (e) {
            assert.fail(`Failed to load analyzer engine: ${e}`);
        }
    });

    test('Python analyzer module should be loadable', async () => {
        try {
            const { analyzePython } = await import('../src/python/pythonAnalyzer');
            assert.ok(analyzePython, 'analyzePython function should be exported');
        } catch (e) {
            assert.fail(`Failed to load Python analyzer: ${e}`);
        }
    });

    test('C# analyzer module should be loadable', async () => {
        try {
            const { analyzeCSharp } = await import('../src/csharp/csharpAnalyzer');
            assert.ok(analyzeCSharp, 'analyzeCSharp function should be exported');
        } catch (e) {
            assert.fail(`Failed to load C# analyzer: ${e}`);
        }
    });
});

suite('Git Integration Tests', () => {
    test('Git integration module should be loadable', async () => {
        try {
            const { GitIntegration } = await import('../src/git/gitIntegration');
            assert.ok(GitIntegration, 'GitIntegration class should be exported');
        } catch (e) {
            assert.fail(`Failed to load Git integration: ${e}`);
        }
    });
});

suite('Codebase Scanner Tests', () => {
    test('Codebase scanner module should be loadable', async () => {
        try {
            const { runScan } = await import('../src/scanner/codebaseScanner');
            assert.ok(runScan, 'runScan function should be exported');
        } catch (e) {
            assert.fail(`Failed to load codebase scanner: ${e}`);
        }
    });
});

suite('Diagnostics Tests', () => {
    test('Diagnostics module should be loadable', async () => {
        try {
            const { reportDiagnostics } = await import('../src/diagnostics/diagnosticsEngine');
            assert.ok(reportDiagnostics, 'reportDiagnostics function should be exported');
        } catch (e) {
            assert.fail(`Failed to load diagnostics: ${e}`);
        }
    });
});