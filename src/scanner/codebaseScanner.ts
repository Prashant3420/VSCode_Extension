import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { ConfigManager, ProjectProfile, NamingConventions, ArchitecturePattern, ModuleStructure, FilePatterns } from '../config/configManager';

export interface ScanOptions {
    force?: boolean;
    language?: 'python' | 'csharp' | 'mixed' | 'auto';
}

export interface ScanResult {
    success: boolean;
    profile?: ProjectProfile;
    error?: string;
    filesScanned: number;
}

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
            const files = await this.getTrackedFiles(language === 'mixed' ? 'python' : language);

            if (files.length === 0) {
                return { success: false, error: 'No tracked files found', filesScanned: 0 };
            }

            const namingConventions = await this.extractNamingConventions(files, language);
            const moduleStructure = await this.extractModuleStructure(files);
            const architecture = this.detectArchitecture(moduleStructure, language);
            const filePatterns = this.extractFilePatterns(files, language);

            const profile: ProjectProfile = {
                version: '1.0.0',
                lastScanned: new Date().toISOString(),
                language: language === 'auto' ? 'python' : language,
                namingConventions,
                moduleStructure,
                architecture,
                filePatterns,
            };

            this.configManager.saveProjectProfile(profile);

            return { success: true, profile, filesScanned: files.length };
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

        if (pyFiles.length > 0 && csFiles.length > 0) return 'mixed';
        if (pyFiles.length > csFiles.length) return 'python';
        return 'csharp';
    }

    private async getTrackedFiles(language: any): Promise<string[]> {
        try {
            const result = execSync('git ls-files', { cwd: this.workspaceRoot, encoding: 'utf-8' });
            let files = result.trim().split('\n').filter(line => line.trim());

            if (language === 'python') {
                files = files.filter(f => f.endsWith('.py'));
            } else if (language === 'csharp') {
                files = files.filter(f => f.endsWith('.cs'));
            }

            return files;
        } catch (error) {
            console.error('Failed to get tracked files:', error);
            return [];
        }
    }

    private async extractNamingConventions(files: string[], language: string): Promise<NamingConventions> {
        const conventions: NamingConventions = {
            classes: 'PascalCase',
            functions: language === 'python' ? 'snake_case' : 'PascalCase',
            variables: language === 'python' ? 'snake_case' : 'camelCase',
            files: language === 'python' ? 'snake_case' : 'PascalCase',
            constants: 'UPPER_SNAKE_CASE',
            interfaces: language === 'csharp' ? 'I PascalCase' : '',
            enums: language === 'csharp' ? 'PascalCase' : '',
        };
        return conventions;
    }

    private async extractModuleStructure(files: string[]): Promise<ModuleStructure> {
        const rootModules = new Set<string>();

        for (const file of files) {
            const parts = file.split(path.sep);
            if (parts.length > 1) {
                rootModules.add(parts[0]);
            }
        }

        const root = this.workspaceRoot.split(path.sep).pop() || '';

        return {
            root,
            modules: Array.from(rootModules),
            patterns: [],
        };
    }

    private detectArchitecture(moduleStructure: ModuleStructure, language: string): ArchitecturePattern {
        const modules = moduleStructure.modules.map(m => m.toLowerCase());

        if (modules.includes('controllers') || modules.includes('api')) {
            return { type: 'mvc', layers: ['controllers', 'models', 'views'] };
        }
        if (modules.includes('viewmodels')) {
            return { type: 'mvvm', layers: ['models', 'viewmodels', 'views'] };
        }
        if (modules.includes('domain') && modules.includes('application')) {
            return { type: 'clean', layers: ['domain', 'application', 'infrastructure'] };
        }
        if (modules.includes('services') || modules.includes('repositories')) {
            return { type: 'layered', layers: ['controllers', 'services', 'repositories', 'models'] };
        }

        return { type: 'unknown' };
    }

    private extractFilePatterns(files: string[], language: string): FilePatterns {
        return {
            naming: language === 'python' ? 'snake_case' : 'PascalCase',
            organization: 'hierarchical',
        };
    }

    public async forceRescan(): Promise<ScanResult> {
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