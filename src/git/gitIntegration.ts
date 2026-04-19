import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { ConfigManager } from '../config/configManager';

export interface StagedFile {
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
    language: 'python' | 'csharp' | 'unknown';
}

const HOOK_SCRIPT = `#!/bin/bash
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
`;

export class GitIntegration {
    private configManager: ConfigManager;
    private hookInstalled: boolean = false;
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.configManager = ConfigManager.getInstance();
        this.configManager.initialize(workspaceRoot);
    }

    public async initialize(): Promise<void> {
        try {
            this.checkHookInstalled();
        } catch (error) {
            console.error('GitIntegration init error:', error);
        }
    }

    public async getStagedFiles(repo?: any): Promise<StagedFile[]> {
        try {
            const stagedFiles: StagedFile[] = [];

            const result = execSync('git diff --cached --name-status', {
                cwd: this.workspaceRoot,
                encoding: 'utf-8',
            });

            const lines = result.trim().split('\n').filter(line => line.trim());

            for (const line of lines) {
                const parts = line.split('\t');
                if (parts.length < 2) continue;

                const statusChar = parts[0][0];
                const filePath = parts[1];

                let status: StagedFile['status'] = 'modified';
                if (statusChar === 'A') status = 'added';
                else if (statusChar === 'M') status = 'modified';
                else if (statusChar === 'D') status = 'deleted';
                else if (statusChar === 'R') status = 'renamed';

                const language = this.detectLanguage(filePath);
                stagedFiles.push({ path: filePath, status, language });
            }

            return stagedFiles;
        } catch (error) {
            console.error('Failed to get staged files:', error);
            return [];
        }
    }

    public async getStagedFilesOnly(): Promise<StagedFile[]> {
        return this.getStagedFiles();
    }

    public async getModifiedFiles(): Promise<string[]> {
        try {
            const result = execSync('git diff --name-only', {
                cwd: this.workspaceRoot,
                encoding: 'utf-8',
            });
            return result.trim().split('\n').filter(line => line.trim());
        } catch (error) {
            console.error('Failed to get modified files:', error);
            return [];
        }
    }

    public async getAllTrackedFiles(): Promise<string[]> {
        try {
            const result = execSync('git ls-files', {
                cwd: this.workspaceRoot,
                encoding: 'utf-8',
            });
            return result.trim().split('\n').filter(line => line.trim());
        } catch (error) {
            console.error('Failed to get tracked files:', error);
            return [];
        }
    }

    private detectLanguage(filePath: string): StagedFile['language'] {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.py') return 'python';
        if (ext === '.cs') return 'csharp';
        return 'unknown';
    }

    private checkHookInstalled(): void {
        const hookPath = path.join(this.workspaceRoot, '.git', 'hooks', 'pre-commit');
        this.hookInstalled = fs.existsSync(hookPath);

        if (this.hookInstalled) {
            try {
                const content = fs.readFileSync(hookPath, 'utf-8');
                this.hookInstalled = content.includes('Code Quality Guardian');
            } catch {
                this.hookInstalled = false;
            }
        }
    }

    public isHookInstalled(): boolean {
        return this.hookInstalled;
    }

    public async installHook(): Promise<boolean> {
        try {
            const gitDir = path.join(this.workspaceRoot, '.git');
            const hooksDir = path.join(gitDir, 'hooks');

            if (!fs.existsSync(hooksDir)) {
                fs.mkdirSync(hooksDir, { recursive: true });
            }

            const hookPath = path.join(hooksDir, 'pre-commit');
            fs.writeFileSync(hookPath, HOOK_SCRIPT);
            fs.chmodSync(hookPath, 0o755);

            this.hookInstalled = true;

            vscode.window.showInformationMessage('Code Quality: Pre-commit hook installed successfully!');
            return true;
        } catch (error) {
            console.error('Failed to install hook:', error);
            vscode.window.showErrorMessage(`Failed to install hook: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return false;
        }
    }

    public async uninstallHook(): Promise<boolean> {
        try {
            const hookPath = path.join(this.workspaceRoot, '.git', 'hooks', 'pre-commit');

            if (fs.existsSync(hookPath)) {
                fs.unlinkSync(hookPath);
            }

            this.hookInstalled = false;

            vscode.window.showInformationMessage('Code Quality: Pre-commit hook uninstalled!');
            return true;
        } catch (error) {
            console.error('Failed to uninstall hook:', error);
            vscode.window.showErrorMessage(`Failed to uninstall hook: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return false;
        }
    }

    public async showHookInstallationPrompt(): Promise<void> {
        if (this.hookInstalled || !this.configManager.shouldAutoInstallHooks()) {
            return;
        }

        const response = await vscode.window.showInformationMessage(
            'Code Quality Guardian: Pre-commit hook not installed. Would you like to install it now?',
            'Install',
            'Later',
            'Never'
        );

        if (response === 'Install') {
            await this.installHook();
        }
    }

    public dispose(): void {
        // Cleanup if needed
    }
}

export function createGitIntegration(workspaceRoot: string): GitIntegration {
    return new GitIntegration(workspaceRoot);
}

export async function getStagedFiles(workspaceRoot: string): Promise<StagedFile[]> {
    const git = new GitIntegration(workspaceRoot);
    await git.initialize();
    return git.getStagedFilesOnly();
}

export async function hasStagedChanges(workspaceRoot: string): Promise<boolean> {
    const files = await getStagedFiles(workspaceRoot);
    return files.length > 0;
}