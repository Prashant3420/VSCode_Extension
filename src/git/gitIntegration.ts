import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync, exec } from 'child_process';
import { ConfigManager } from '../config/configManager';

export interface StagedFile {
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed';
    language: 'python' | 'csharp' | 'unknown';
}

export interface GitCommitState {
    repository: vscode.ScmRepository;
    indexChanges: StagedFile[];
    headChanges: any[];
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
    private static instance: GitIntegration;
    private scmProvider: vscode.SourceControl;
    private configManager: ConfigManager;
    private hookInstalled: boolean = false;
    private commitListeners: vscode.Disposable[] = [];
    private workspaceRoot: string;

    private constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.configManager = ConfigManager.getInstance();
        this.configManager.initialize(workspaceRoot);
    }

    public static getInstance(workspaceRoot: string): GitIntegration {
        if (!GitIntegration.instance) {
            GitIntegration.instance = new GitIntegration(workspaceRoot);
        }
        return GitIntegration.instance;
    }

    public async initialize(): Promise<void> {
        await this.setupSourceControl();
        this.checkHookInstalled();
    }

    private async setupSourceControl(): Promise<void> {
        const scm = vscode.scm;
        if (!scm) {
            console.log('No SCM provider available');
            return;
        }

        const repositories = scm.repositories;
        if (repositories.length === 0) {
            console.log('No repositories found');
            return;
        }

        for (const repo of repositories) {
            this.listenToRepository(repo);
        }
    }

    private listenToRepository(repo: vscode.ScmRepository): void {
        const changeDisposable = repo.state.onDidChange(() => {
            this.handleRepositoryChange(repo);
        });
        this.commitListeners.push(changeDisposable);

        const commitDisposable = repo.inputBox.onDidChange(() => {
            if (this.configManager.shouldAutoRunOnCommit()) {
                this.handleCommitAttempt(repo);
            }
        });
        this.commitListeners.push(commitDisposable);
    }

    private async handleRepositoryChange(repo: vscode.ScmRepository): Promise<void> {
        const stagedFiles = await this.getStagedFiles(repo);
        console.log('Repository changed, staged files:', stagedFiles.map(f => f.path).join(', '));
    }

    private async handleCommitAttempt(repo: vscode.ScmRepository): Promise<void> {
        const stagedFiles = await this.getStagedFiles(repo);

        if (stagedFiles.length === 0) {
            return;
        }

        const { runChecks } = await import('../analyzer/engine');
        try {
            const results = await runChecks(stagedFiles, this.workspaceRoot);

            const hasErrors = results.some(r => r.errors.length > 0);
            if (hasErrors) {
                vscode.window.showErrorMessage('Code Quality: Commit blocked due to quality violations. Run "Code Quality: Run Quality Checks" for details.');
                throw new Error('Code quality checks failed');
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Code Quality: ${error instanceof Error ? error.message : 'Commit blocked due to quality violations'}`);
            throw error;
        }
    }

    public async getStagedFiles(repo?: vscode.ScmRepository): Promise<StagedFile[]> {
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

    private detectLanguage(filePath: string): StagedFile['language'] {
        const ext = path.extname(filePath).toLowerCase();
        if (ext === '.py') return 'python';
        if (ext === '.cs') return 'csharp';
        return 'unknown';
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
        for (const listener of this.commitListeners) {
            listener.dispose();
        }
        this.commitListeners = [];
    }
}

export async function createGitIntegration(workspaceRoot: string): Promise<GitIntegration> {
    const instance = GitIntegration.getInstance(workspaceRoot);
    await instance.initialize();
    return instance;
}

export async function getStagedFiles(workspaceRoot: string): Promise<StagedFile[]> {
    const git = GitIntegration.getInstance(workspaceRoot);
    return git.getStagedFilesOnly();
}

export async function hasStagedChanges(workspaceRoot: string): Promise<boolean> {
    const files = await getStagedFiles(workspaceRoot);
    return files.length > 0;
}