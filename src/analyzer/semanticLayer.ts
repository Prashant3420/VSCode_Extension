import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { StagedFile } from '../git/gitIntegration';
import { ConfigManager } from '../config/configManager';

export interface SemanticAnalysisResult {
    tool: string;
    success: boolean;
    errors: AnalysisError[];
    warnings: AnalysisError[];
    output: string;
    executionTime: number;
    layer: 'semantic';
}

export interface AnalysisError {
    line: number;
    column?: number;
    message: string;
    code?: string;
    severity: 'error' | 'warning' | 'info';
    file?: string;
}

export async function analyzeSemantically(
    stagedFiles: StagedFile[],
    workspaceRoot: string
): Promise<SemanticAnalysisResult[]> {
    const results: SemanticAnalysisResult[] = [];
    const configManager = ConfigManager.getInstance();
    configManager.initialize(workspaceRoot);

    const profile = configManager.loadProjectProfile();

    if (profile) {
        results.push(await validateAgainstProfile(stagedFiles, profile, workspaceRoot));
    }

    results.push(await validateCrossFileReferences(stagedFiles, workspaceRoot));
    results.push(await validateDependencyPatterns(stagedFiles, workspaceRoot));

    return results;
}

async function validateAgainstProfile(
    stagedFiles: StagedFile[],
    profile: any,
    workspaceRoot: string
): Promise<SemanticAnalysisResult> {
    const startTime = Date.now();
    const result: SemanticAnalysisResult = {
        tool: 'profile-validation',
        success: true,
        errors: [],
        warnings: [],
        output: '',
        executionTime: 0,
        layer: 'semantic',
    };

    const namingConventions = profile.namingConventions;

    for (const file of stagedFiles) {
        const fullPath = path.join(workspaceRoot, file.path);
        if (!fs.existsSync(fullPath)) continue;

        try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const lineNum = i + 1;

                if (file.language === 'python') {
                    const classMatch = line.match(/^class\s+(\w+)/);
                    if (classMatch) {
                        const name = classMatch[1];
                        if (namingConventions.classes === 'PascalCase' && !/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
                            result.errors.push({
                                line: lineNum,
                                message: `Class name "${name}" should follow PascalCase`,
                                code: 'SEM001',
                                severity: 'error',
                                file: file.path,
                            });
                        }
                    }

                    const funcMatch = line.match(/^\s*def\s+(\w+)/);
                    if (funcMatch) {
                        const name = funcMatch[1];
                        if (namingConventions.functions === 'snake_case' && !/^[a-z_][a-z0-9_]*$/.test(name)) {
                            result.errors.push({
                                line: lineNum,
                                message: `Function name "${name}" should follow snake_case`,
                                code: 'SEM002',
                                severity: 'error',
                                file: file.path,
                            });
                        }
                    }
                } else if (file.language === 'csharp') {
                    const classMatch = line.match(/^(public|internal|private)?\s*(class|interface|struct)\s+(\w+)/);
                    if (classMatch) {
                        const name = classMatch[3];
                        if (!/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
                            result.errors.push({
                                line: lineNum,
                                message: `Type name "${name}" should follow PascalCase`,
                                code: 'SEM003',
                                severity: 'error',
                                file: file.path,
                            });
                        }
                    }

                    const methodMatch = line.match(/^(public|private|protected|internal)\s+(\w+)\s+(\w+)\s*\(/);
                    if (methodMatch) {
                        const name = methodMatch[3];
                        if (name[0] === name[0].toLowerCase() && !name.startsWith('_')) {
                            result.errors.push({
                                line: lineNum,
                                message: `Method name "${name}" should follow PascalCase`,
                                code: 'SEM004',
                                severity: 'error',
                                file: file.path,
                            });
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`Failed to validate ${file.path} against profile:`, error);
        }
    }

    result.success = result.errors.length === 0;
    result.executionTime = Date.now() - startTime;
    return result;
}

async function validateCrossFileReferences(
    stagedFiles: StagedFile[],
    workspaceRoot: string
): Promise<SemanticAnalysisResult> {
    const startTime = Date.now();
    const result: SemanticAnalysisResult = {
        tool: 'cross-file-validation',
        success: true,
        errors: [],
        warnings: [],
        output: '',
        executionTime: 0,
        layer: 'semantic',
    };

    const allFiles = new Map<string, Set<string>>();

    for (const file of stagedFiles) {
        const fullPath = path.join(workspaceRoot, file.path);
        if (!fs.existsSync(fullPath)) continue;

        try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const imports = extractImports(content, file.language);
            allFiles.set(file.path, imports);
        } catch (error) {
            console.error(`Failed to read ${file.path}:`, error);
        }
    }

    for (const [filePath, imports] of allFiles) {
        for (const importName of imports) {
            const referencedFile = resolveImportToFile(importName, filePath, workspaceRoot, stagedFiles[0]?.language || 'python');

            if (!referencedFile) {
                const importType = stagedFiles[0]?.language === 'python' ? 'import' : 'using';
                result.warnings.push({
                    line: 0,
                    message: `Cannot resolve ${importType}: ${importName}`,
                    code: 'SEM010',
                    severity: 'warning',
                    file: filePath,
                });
            }
        }
    }

    result.success = result.errors.length === 0;
    result.executionTime = Date.now() - startTime;
    return result;
}

function extractImports(content: string, language: string): Set<string> {
    const imports = new Set<string>();
    const lines = content.split('\n');

    for (const line of lines) {
        if (language === 'python') {
            const importMatch = line.match(/^(?:from\s+(\S+)\s+)?import\s+(\S+)/);
            if (importMatch) {
                const module = importMatch[1] || importMatch[2];
                imports.add(module);
            }
        } else if (language === 'csharp') {
            const usingMatch = line.match(/^using\s+([.\w]+)/);
            if (usingMatch) {
                imports.add(usingMatch[1]);
            }
        }
    }

    return imports;
}

function resolveImportToFile(
    importName: string,
    currentFile: string,
    workspaceRoot: string,
    language: string
): string | null {
    const ext = language === 'python' ? '.py' : '.cs';

    const possiblePaths = [
        path.join(workspaceRoot, importName.replace(/\./g, path.sep) + ext),
        path.join(workspaceRoot, path.dirname(currentFile), importName.replace(/\./g, path.sep) + ext),
    ];

    for (const possiblePath of possiblePaths) {
        if (fs.existsSync(possiblePath)) {
            return possiblePath;
        }
    }

    return null;
}

async function validateDependencyPatterns(
    stagedFiles: StagedFile[],
    workspaceRoot: string
): Promise<SemanticAnalysisResult> {
    const startTime = Date.now();
    const result: SemanticAnalysisResult = {
        tool: 'dependency-validation',
        success: true,
        errors: [],
        warnings: [],
        output: '',
        executionTime: 0,
        layer: 'semantic',
    };

    const allImports = new Map<string, Set<string>>();

    for (const file of stagedFiles) {
        const fullPath = path.join(workspaceRoot, file.path);
        if (!fs.existsSync(fullPath)) continue;

        try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const imports = extractImports(content, file.language);
            allImports.set(file.path, imports);
        } catch (error) {
            console.error(`Failed to read ${file.path}:`, error);
        }
    }

    const configManager = ConfigManager.getInstance();
    const profile = configManager.loadProjectProfile();

    if (profile && profile.architecture && profile.architecture.type !== 'unknown') {
        const layers = profile.architecture.layers || [];
        const layerMap = new Map<string, number>();

        for (let i = 0; i < layers.length; i++) {
            layerMap.set(layers[i], i);
        }

        for (const [filePath, imports] of allImports) {
            const fileDir = path.dirname(filePath);
            const fileLayer = layers.find(l => fileDir.includes(l));

            if (!fileLayer) continue;

            for (const importedModule of imports) {
                const importDir = importedModule.split('.')[0];
                const importLayer = layers.find(l => importDir.includes(l));

                if (!importLayer) continue;

                const fileLayerIdx = layerMap.get(fileLayer) ?? 0;
                const importLayerIdx = layerMap.get(importLayer) ?? 0;

                if (fileLayerIdx > importLayerIdx) {
                    result.errors.push({
                        line: 0,
                        message: `Invalid dependency: ${fileLayer} layer depends on ${importLayer} layer (should be reverse)`,
                        code: 'SEM020',
                        severity: 'error',
                        file: filePath,
                    });
                }
            }
        }
    }

    result.success = result.errors.length === 0;
    result.executionTime = Date.now() - startTime;
    return result;
}

export function analyzeSemantically(
    stagedFiles: StagedFile[],
    workspaceRoot: string
): Promise<SemanticAnalysisResult[]> {
    return analyzeSemantically(stagedFiles, workspaceRoot);
}