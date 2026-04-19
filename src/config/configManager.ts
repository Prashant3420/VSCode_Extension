import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface SeverityLevel {
    level: 'off' | 'warning' | 'error';
    severity: vscode.DiagnosticSeverity;
}

export interface PythonConfig {
    runPylint: SeverityLevel;
    runFlake8: SeverityLevel;
    runBlack: SeverityLevel;
    runIsort: SeverityLevel;
    runMypy: SeverityLevel;
    runBandit: SeverityLevel;
    enforceNaming: SeverityLevel;
    enforceDocstrings: SeverityLevel;
}

export interface CSharpConfig {
    runRoslyn: SeverityLevel;
    runStyleCop: SeverityLevel;
    runSonarAnalyzer: SeverityLevel;
    runDotnetFormat: SeverityLevel;
    enforceNaming: SeverityLevel;
}

export interface TypeScriptConfig {
    runTsc: SeverityLevel;
    runEslint: SeverityLevel;
    enforceNaming: SeverityLevel;
}

export interface JavaScriptConfig {
    runEslint: SeverityLevel;
    enforceNaming: SeverityLevel;
}

export interface AnalysisConfig {
    enableAstAnalysis: boolean;
    enableSemanticAnalysis: boolean;
    enableImpactAnalysis: boolean;
    enableCodebaseScan: boolean;
}

export interface CodeQualityConfig {
    strict: boolean;
    autoInstallHooks: boolean;
    enableAutoOnCommit: boolean;
    python: PythonConfig;
    csharp: CSharpConfig;
    typescript: TypeScriptConfig;
    javascript: JavaScriptConfig;
    analysis: AnalysisConfig;
}

export interface ProjectProfile {
    version: string;
    lastScanned: string;
    language: 'python' | 'csharp' | 'mixed';
    namingConventions: NamingConventions;
    moduleStructure: ModuleStructure;
    architecture: ArchitecturePattern;
    filePatterns: FilePatterns;
}

export interface NamingConventions {
    classes: string;
    functions: string;
    variables: string;
    files: string;
    constants: string;
    interfaces: string;
    enums: string;
}

export interface ModuleStructure {
    root: string;
    modules: string[];
    patterns: string[];
}

export interface ArchitecturePattern {
    type: 'layered' | 'mvc' | 'mvvm' | 'clean' | 'modular' | 'unknown';
    layers?: string[];
}

export interface FilePatterns {
    naming: string;
    organization: string;
}

const DEFAULT_CONFIG: CodeQualityConfig = {
    strict: true,
    autoInstallHooks: false,
    enableAutoOnCommit: true,
    python: {
        runPylint: { level: 'error', severity: vscode.DiagnosticSeverity.Error },
        runFlake8: { level: 'error', severity: vscode.DiagnosticSeverity.Error },
        runBlack: { level: 'error', severity: vscode.DiagnosticSeverity.Error },
        runIsort: { level: 'error', severity: vscode.DiagnosticSeverity.Error },
        runMypy: { level: 'warning', severity: vscode.DiagnosticSeverity.Warning },
        runBandit: { level: 'error', severity: vscode.DiagnosticSeverity.Error },
        enforceNaming: { level: 'error', severity: vscode.DiagnosticSeverity.Error },
        enforceDocstrings: { level: 'warning', severity: vscode.DiagnosticSeverity.Warning },
    },
    csharp: {
        runRoslyn: { level: 'error', severity: vscode.DiagnosticSeverity.Error },
        runStyleCop: { level: 'error', severity: vscode.DiagnosticSeverity.Error },
        runSonarAnalyzer: { level: 'error', severity: vscode.DiagnosticSeverity.Error },
        runDotnetFormat: { level: 'error', severity: vscode.DiagnosticSeverity.Error },
        enforceNaming: { level: 'error', severity: vscode.DiagnosticSeverity.Error },
    },
    typescript: {
        runTsc: { level: 'error', severity: vscode.DiagnosticSeverity.Error },
        runEslint: { level: 'error', severity: vscode.DiagnosticSeverity.Error },
        enforceNaming: { level: 'error', severity: vscode.DiagnosticSeverity.Error },
    },
    javascript: {
        runEslint: { level: 'error', severity: vscode.DiagnosticSeverity.Error },
        enforceNaming: { level: 'error', severity: vscode.DiagnosticSeverity.Error },
    },
    analysis: {
        enableAstAnalysis: true,
        enableSemanticAnalysis: true,
        enableImpactAnalysis: true,
        enableCodebaseScan: true,
    },
};

export class ConfigManager {
    private static instance: ConfigManager;
    private config: CodeQualityConfig;
    private profile: ProjectProfile | null = null;
    private profilePath: string;
    private configPath: string;
    private workspaceRoot: string | null;

    private constructor() {
        this.config = DEFAULT_CONFIG;
        this.workspaceRoot = null;
        this.profilePath = '';
        this.configPath = '';
    }

    public static getInstance(): ConfigManager {
        if (!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager();
        }
        return ConfigManager.instance;
    }

    public initialize(workspaceRoot: string): void {
        this.workspaceRoot = workspaceRoot;
        this.profilePath = path.join(workspaceRoot, '.code-quality', 'profile.json');
        this.configPath = path.join(workspaceRoot, '.code-quality', 'config.json');
        this.loadConfig();
    }

    private loadConfig(): void {
        const config = vscode.workspace.getConfiguration('codeQuality');

        this.config.strict = config.get<boolean>('strict', DEFAULT_CONFIG.strict);
        this.config.autoInstallHooks = config.get<boolean>('autoInstallHooks', DEFAULT_CONFIG.autoInstallHooks);
        this.config.enableAutoOnCommit = config.get<boolean>('enableAutoOnCommit', DEFAULT_CONFIG.enableAutoOnCommit);

        const pythonKeys: (keyof PythonConfig)[] = [
            'runPylint', 'runFlake8', 'runBlack', 'runIsort', 'runMypy', 'runBandit', 'enforceNaming', 'enforceDocstrings'
        ];
        for (const key of pythonKeys) {
            const value = config.get<string>(`python.${key}`, DEFAULT_CONFIG.python[key].level);
            this.config.python[key] = this.parseSeverity(value as string);
        }

        const csharpKeys: (keyof CSharpConfig)[] = [
            'runRoslyn', 'runStyleCop', 'runSonarAnalyzer', 'runDotnetFormat', 'enforceNaming'
        ];
        for (const key of csharpKeys) {
            const value = config.get<string>(`csharp.${key}`, DEFAULT_CONFIG.csharp[key].level);
            this.config.csharp[key] = this.parseSeverity(value as string);
        }

        const typescriptKeys: (keyof TypeScriptConfig)[] = [
            'runTsc', 'runEslint', 'enforceNaming'
        ];
        for (const key of typescriptKeys) {
            const value = config.get<string>(`typescript.${key}`, DEFAULT_CONFIG.typescript[key].level);
            this.config.typescript[key] = this.parseSeverity(value as string);
        }

        const javascriptKeys: (keyof JavaScriptConfig)[] = [
            'runEslint', 'enforceNaming'
        ];
        for (const key of javascriptKeys) {
            const value = config.get<string>(`javascript.${key}`, DEFAULT_CONFIG.javascript[key].level);
            this.config.javascript[key] = this.parseSeverity(value as string);
        }

        this.config.analysis.enableAstAnalysis = config.get<boolean>('analysis.enableAstAnalysis', DEFAULT_CONFIG.analysis.enableAstAnalysis);
        this.config.analysis.enableSemanticAnalysis = config.get<boolean>('analysis.enableSemanticAnalysis', DEFAULT_CONFIG.analysis.enableSemanticAnalysis);
        this.config.analysis.enableImpactAnalysis = config.get<boolean>('analysis.enableImpactAnalysis', DEFAULT_CONFIG.analysis.enableImpactAnalysis);
        this.config.analysis.enableCodebaseScan = config.get<boolean>('analysis.enableCodebaseScan', DEFAULT_CONFIG.analysis.enableCodebaseScan);
    }

    private parseSeverity(value: string): SeverityLevel {
        const severityMap: Record<string, vscode.DiagnosticSeverity> = {
            'off': vscode.DiagnosticSeverity.Hint,
            'warning': vscode.DiagnosticSeverity.Warning,
            'error': vscode.DiagnosticSeverity.Error,
        };
        return {
            level: value as 'off' | 'warning' | 'error',
            severity: severityMap[value] || vscode.DiagnosticSeverity.Error,
        };
    }

    public getConfig(): CodeQualityConfig {
        return { ...this.config };
    }

    public getPythonConfig(): PythonConfig {
        return { ...this.config.python };
    }

    public getCSharpConfig(): CSharpConfig {
        return { ...this.config.csharp };
    }

    public getTypeScriptConfig(): TypeScriptConfig {
        return { ...this.config.typescript };
    }

    public getJavaScriptConfig(): JavaScriptConfig {
        return { ...this.config.javascript };
    }

    public getAnalysisConfig(): AnalysisConfig {
        return { ...this.config.analysis };
    }

    public loadProjectProfile(): ProjectProfile | null {
        try {
            if (fs.existsSync(this.profilePath)) {
                const content = fs.readFileSync(this.profilePath, 'utf-8');
                this.profile = JSON.parse(content);
                return this.profile;
            }
        } catch (error) {
            console.error('Failed to load project profile:', error);
        }
        return null;
    }

    public saveProjectProfile(profile: ProjectProfile): void {
        try {
            const dir = path.dirname(this.profilePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.profilePath, JSON.stringify(profile, null, 2));
            this.profile = profile;
        } catch (error) {
            console.error('Failed to save project profile:', error);
            throw error;
        }
    }

    public getProjectProfile(): ProjectProfile | null {
        return this.profile;
    }

    public isStrictMode(): boolean {
        return this.config.strict;
    }

    public shouldAutoInstallHooks(): boolean {
        return this.config.autoInstallHooks;
    }

    public shouldAutoRunOnCommit(): boolean {
        return this.config.enableAutoOnCommit;
    }

    public updateConfig(newConfig: Partial<CodeQualityConfig>): void {
        this.config = { ...this.config, ...newConfig };
        this.persistConfig();
    }

    private persistConfig(): void {
        try {
            const dir = path.dirname(this.configPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
        } catch (error) {
            console.error('Failed to persist config:', error);
        }
    }

    public getSeverityForTool(tool: string, language: 'python' | 'csharp'): SeverityLevel {
        const key = tool as keyof (PythonConfig | CSharpConfig);
        if (language === 'python') {
            return this.config.python[key as keyof PythonConfig] || DEFAULT_CONFIG.python.runPylint;
        } else {
            return this.config.csharp[key as keyof CSharpConfig] || DEFAULT_CONFIG.csharp.runRoslyn;
        }
    }

    public shouldSkipTool(tool: string, language: 'python' | 'csharp'): boolean {
        const severity = this.getSeverityForTool(tool, language);
        return severity.level === 'off';
    }

    public getWorkspaceRoot(): string | null {
        return this.workspaceRoot;
    }
}