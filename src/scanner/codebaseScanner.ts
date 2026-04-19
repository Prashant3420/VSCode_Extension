import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { ConfigManager, ProjectProfile, NamingConventions, ArchitecturePattern, ModuleStructure, FilePatterns } from '../config/configManager';
import * as vscode from 'vscode';

export interface ScanOptions {
    force?: boolean;
    language?: 'python' | 'csharp' | 'auto';
}

export interface ScanResult {
    success: boolean;
    profile?: ProjectProfile;
    error?: string;
    filesScanned: number;
}

const PYTHON_PATTERNS = {
    classes: /^(class\s+)(\w+)/g,
    functions: /^(def\s+)(\w+)/gm,
    variables: /^(\s*)(\w+)\s*=/gm,
    constants: /^([A-Z][A-Z0-9_]+)\s*=/g,
    imports: /^import\s+(\w+)/gm,
    fromImports: /^from\s+(\w+)\s+import/gm,
};

const CSHARP_PATTERNS = {
    classes: /^(public\s+)?(class|interface|enum|struct)\s+(\w+)/gm,
    methods: /^(public|private|protected|internal|static|\s)+(\w+)\s+(\w+)\s*\(/gm,
    variables: /^(private|public|protected|internal)\s+(\w+)\s+(\w+)\s*=/gm,
    fields: /^(private|public|protected|internal)\s+readonly\s+(\w+)\s+(\w+)\s*=/gm,
    constants: /^(public\s+)?const\s+(\w+)\s+(\w+)\s*=/gm,
    interfaces: /^interface\s+(\w+)/gm,
    namespaces: /^namespace\s+([.\w]+)/gm,
    using: /^using\s+([.\w]+);/gm,
};

export class CodebaseScanner {
    private configManager: ConfigManager;
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.configManager = ConfigManager.getInstance();
        this.configManager.initialize(workspaceRoot);
    }

    public async scan(options: ScanOptions = {}): Promise<ScanResult> {
        const existingProfile = this.configManager.loadProjectProfile();

        if (existingProfile && !options.force) {
            return {
                success: true,
                profile: existingProfile,
                filesScanned: 0,
            };
        }

        try {
            const language = options.language || await this.detectLanguage();
            const files = await this.getTrackedFiles(language);

            if (files.length === 0) {
                return {
                    success: false,
                    error: 'No tracked files found',
                    filesScanned: 0,
                };
            }

            const namingConventions = await this.extractNamingConventions(files, language);
            const moduleStructure = await this.extractModuleStructure(files, language);
            const architecture = this.detectArchitecture(moduleStructure, language);
            const filePatterns = this.extractFilePatterns(files, language);

            const profile: ProjectProfile = {
                version: '1.0.0',
                lastScanned: new Date().toISOString(),
                language,
                namingConventions,
                moduleStructure,
                architecture,
                filePatterns,
            };

            this.configManager.saveProjectProfile(profile);

            return {
                success: true,
                profile,
                filesScanned: files.length,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                filesScanned: 0,
            };
        }
    }

    private async detectLanguage(): Promise<'python' | 'csharp' | 'mixed'> {
        const pyFiles = await this.getTrackedFiles('python');
        const csFiles = await this.getTrackedFiles('csharp');

        if (pyFiles.length > 0 && csFiles.length > 0) {
            return 'mixed';
        }

        if (pyFiles.length > csFiles.length) {
            return 'python';
        }

        return 'csharp';
    }

    private async getTrackedFiles(language: 'python' | 'csharp' | 'all' = 'all'): Promise<string[]> {
        try {
            const result = execSync('git ls-files', {
                cwd: this.workspaceRoot,
                encoding: 'utf-8',
            });

            let files = result.trim().split('\n').filter(line => line.trim());

            if (language === 'python') {
                files = files.filter(f => f.endsWith('.py'));
            } else if (language === 'csharp') {
                files = files.filter(f => f.endsWith('.cs'));
            } else {
                files = files.filter(f => f.endsWith('.py') || f.endsWith('.cs'));
            }

            return files;
        } catch (error) {
            console.error('Failed to get tracked files:', error);
            return [];
        }
    }

    private async extractNamingConventions(files: string[], language: 'python' | 'csharp' | 'mixed'): Promise<NamingConventions> {
        const conventions: NamingConventions = {
            classes: language === 'python' ? 'PascalCase' : 'PascalCase',
            functions: language === 'python' ? 'snake_case' : 'PascalCase',
            variables: language === 'python' ? 'snake_case' : 'camelCase',
            files: language === 'python' ? 'snake_case' : 'PascalCase',
            constants: language === 'python' ? 'UPPER_SNAKE_CASE' : 'PascalCase',
            interfaces: language === 'csharp' ? 'I PascalCase' : '',
            enums: language === 'csharp' ? 'PascalCase' : '',
        };

        if (language === 'mixed') {
            return conventions;
        }

        const patternSet = language === 'python' ? PYTHON_PATTERNS : CSHARP_PATTERNS;

        const classNames = new Set<string>();
        const functionNames = new Set<string>();
        const variableNames = new Set<string>();
        const constantNames = new Set<string>();

        for (const file of files) {
            const filePath = path.join(this.workspaceRoot, file);
            if (!fs.existsSync(filePath)) continue;

            try {
                const content = fs.readFileSync(filePath, 'utf-8');

                const classMatch = content.matchAll(patternSet.classes as RegExp);
                for (const match of classMatch) {
                    const name = language === 'python' ? match[2] : match[3];
                    if (name) classNames.add(name);
                }

                const funcMatch = content.matchAll(patternSet.functions as RegExp);
                for (const match of funcMatch) {
                    const name = language === 'python' ? match[2] : match[3];
                    if (name) functionNames.add(name);
                }

                const varMatch = content.matchAll(patternSet.variables as RegExp);
                for (const match of varMatch) {
                    const name = language === 'python' ? match[2] : match[2];
                    if (name && !name.startsWith('_')) variableNames.add(name);
                }

                const constMatch = content.matchAll(patternSet.constants as RegExp);
                for (const match of constMatch) {
                    const name = language === 'python' ? match[1] : match[2];
                    if (name) constantNames.add(name);
                }
            } catch (error) {
                console.error(`Failed to read ${file}:`, error);
            }
        }

        conventions.classes = this.inferConvention(classNames, 'class');
        conventions.functions = this.inferConvention(functionNames, 'function');
        conventions.variables = this.inferConvention(variableNames, 'variable');
        conventions.constants = this.inferConvention(constantNames, 'constant');

        if (language === 'csharp') {
            conventions.interfaces = this.inferConvention(new Set<string>(), 'interface');
        }

        return conventions;
    }

    private inferConvention(names: Set<string>, type: string): string {
        const samples = Array.from(names).slice(0, 20);
        if (samples.length === 0) {
            return type === 'class' ? 'PascalCase' : type === 'constant' ? 'UPPER_SNAKE_CASE' : 'snake_case';
        }

        const hasPascalCase = samples.every(n => /^[A-Z][a-zA-Z0-9]*$/.test(n));
        const hasSnakeCase = samples.every(n => /^[a-z][a-z0-9_]*$/.test(n));
        const hasUpperSnake = samples.every(n => /^[A-Z][A-Z0-9_]*$/.test(n));
        const hasCamelCase = samples.every(n => /^[a-z][a-zA-Z0-9]*$/.test(n));
        const hasISuffix = samples.every(n => n.startsWith('I') && /^[A-Z]/.test(n[1]));

        if (hasPascalCase) return 'PascalCase';
        if (hasSnakeCase) return 'snake_case';
        if (hasUpperSnake) return 'UPPER_SNAKE_CASE';
        if (hasCamelCase) return 'camelCase';
        if (hasISuffix && type === 'interface') return 'I PascalCase';

        if (type === 'class') return 'PascalCase';
        if (type === 'constant') return 'UPPER_SNAKE_CASE';
        if (type === 'variable') return 'snake_case';
        return 'snake_case';
    }

    private async extractModuleStructure(files: string[], language: 'python' | 'csharp' | 'mixed'): Promise<ModuleStructure> {
        const modules = new Set<string>();
        const patterns = new Set<string>();

        const rootModules = new Set<string>();
        for (const file of files) {
            const parts = file.split(path.sep);
            if (parts.length > 1) {
                rootModules.add(parts[0]);
            }

            if (file.includes('/') || file.includes('\\')) {
                patterns.add(path.dirname(file));
            }
        }

        const root = this.workspaceRoot.split(path.sep).pop() || '';

        return {
            root,
            modules: Array.from(rootModules),
            patterns: Array.from(patterns).slice(0, 50),
        };
    }

    private detectArchitecture(moduleStructure: ModuleStructure, language: 'python' | 'csharp' | 'mixed'): ArchitecturePattern {
        const modules = moduleStructure.modules.map(m => m.toLowerCase());
        const patterns = moduleStructure.patterns.map(p => p.toLowerCase());

        if (modules.includes('controllers') || modules.includes('api') || patterns.some(p => p.includes('controller'))) {
            return { type: 'mvc', layers: ['controllers', 'models', 'views'] };
        }

        if (modules.includes('viewmodels') || patterns.some(p => p.includes('viewmodel'))) {
            return { type: 'mvvm', layers: ['models', 'viewmodels', 'views'] };
        }

        if (modules.includes('domain') && modules.includes('application') && modules.includes('infrastructure')) {
            return { type: 'clean', layers: ['domain', 'application', 'infrastructure', 'interface'] };
        }

        if (modules.includes('services') || modules.includes('repositories')) {
            return { type: 'layered', layers: ['controllers', 'services', 'repositories', 'models'] };
        }

        return { type: 'unknown' };
    }

    private extractFilePatterns(files: string[], language: 'python' | 'csharp' | 'mixed'): FilePatterns {
        const naming = new Set<string>();
        const organization = new Set<string>();

        for (const file of files) {
            const baseName = path.basename(file, path.extname(file));
            naming.add(baseName);

            const dir = path.dirname(file);
            if (dir !== '.') {
                organization.add(dir);
            }
        }

        const nameSamples = Array.from(naming).slice(0, 20);
        let namingPattern = 'snake_case';

        if (nameSamples.every(n => /^[A-Z][a-zA-Z0-9]*$/.test(n))) {
            namingPattern = 'PascalCase';
        } else if (nameSamples.every(n => /^[a-z][a-z0-9_]*$/.test(n))) {
            namingPattern = 'snake_case';
        }

        const orgSamples = Array.from(organization).slice(0, 20);
        let orgPattern = 'flat';

        if (orgSamples.some(d => d.includes('/') || d.includes('\\'))) {
            orgPattern = 'hierarchical';
        }

        return {
            naming: namingPattern,
            organization: orgPattern,
        };
    }

    public async forceRescan(): Promise<ScanResult> {
        return this.scan({ force: true });
    }

    public async updateProfile(): Promise<ScanResult> {
        return this.scan({ force: true });
    }

    public getProfile(): ProjectProfile | null {
        return this.configManager.getProjectProfile();
    }
}

export async function createScanner(workspaceRoot: string): Promise<CodebaseScanner> {
    return new CodebaseScanner(workspaceRoot);
}

export async function runScan(workspaceRoot: string, options: ScanOptions = {}): Promise<ScanResult> {
    const scanner = await createScanner(workspaceRoot);
    return scanner.scan(options);
}