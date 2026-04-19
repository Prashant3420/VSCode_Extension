import { runChecks, StagedFile } from '../out/analyzer/engine';
import * as path from 'path';

async function testMultiLanguageRouting() {
    const workspaceRoot = path.join(__dirname, 'test_files');
    
    // Test case 1: Python files
    const pythonFiles: StagedFile[] = [
        { path: 'python/test.py', status: 'added', language: 'python' }
    ];
    
    // Test case 2: TypeScript files
    const typeScriptFiles: StagedFile[] = [
        { path: 'typescript/test.ts', status: 'added', language: 'typescript' }
    ];
    
    // Test case 3: JavaScript files
    const javaScriptFiles: StagedFile[] = [
        { path: 'javascript/test.js', status: 'added', language: 'javascript' }
    ];
    
    // Test case 4: Mixed files
    const mixedFiles: StagedFile[] = [
        { path: 'python/test.py', status: 'added', language: 'python' },
        { path: 'typescript/test.ts', status: 'added', language: 'typescript' },
        { path: 'javascript/test.js', status: 'added', language: 'javascript' },
        { path: 'csharp/test.cs', status: 'added', language: 'csharp' }
    ];
    
    console.log('=== Test 1: Python Only ===');
    const pyResult = await runChecks(pythonFiles, workspaceRoot);
    console.log(`Python result: ${pyResult.success ? 'PASS' : 'FAIL'}, errors: ${pyResult.totalErrors}, warnings: ${pyResult.totalWarnings}`);
    
    console.log('\n=== Test 2: TypeScript Only ===');
    const tsResult = await runChecks(typeScriptFiles, workspaceRoot);
    console.log(`TypeScript result: ${tsResult.success ? 'PASS' : 'FAIL'}, errors: ${tsResult.totalErrors}, warnings: ${tsResult.totalWarnings}`);
    
    console.log('\n=== Test 3: JavaScript Only ===');
    const jsResult = await runChecks(javaScriptFiles, workspaceRoot);
    console.log(`JavaScript result: ${jsResult.success ? 'PASS' : 'FAIL'}, errors: ${jsResult.totalErrors}, warnings: ${jsResult.totalWarnings}`);
    
    console.log('\n=== Test 4: Mixed Files ===');
    const mixedResult = await runChecks(mixedFiles, workspaceRoot);
    console.log(`Mixed result: ${mixedResult.success ? 'PASS' : 'FAIL'}, errors: ${mixedResult.totalErrors}, warnings: ${mixedResult.totalWarnings}`);
    
    // Verify lintResults contain results for all language types
    console.log('\n=== Checking Lint Results ===');
    const toolsFound = new Set(mixedResult.lintResults.map(r => r.tool));
    console.log(`Tools invoked: ${Array.from(toolsFound).join(', ')}`);
    
    // Check if we have results for each language
    const hasPythonResults = mixedResult.lintResults.some(r => r.tool === 'pylint' || r.tool === 'flake8' || r.tool === 'bandit');
    const hasTypeScriptResults = mixedResult.lintResults.some(r => r.tool === 'tsc' || r.tool === 'eslint' || r.tool === 'naming-conventions');
    const hasJavaScriptResults = mixedResult.lintResults.some(r => r.tool === 'eslint');
    const hasCSharpResults = mixedResult.lintResults.some(r => r.tool === 'roslyn' || r.tool === 'stylecop');
    
    console.log(`Has Python results: ${hasPythonResults}`);
    console.log(`Has TypeScript results: ${hasTypeScriptResults}`);
    console.log(`Has JavaScript results: ${hasJavaScriptResults}`);
    console.log(`Has C# results: ${hasCSharpResults}`);
    
    if (!hasPythonResults || !hasTypeScriptResults || !hasJavaScriptResults || !hasCSharpResults) {
        console.log('\n❌ FAIL: Not all language types are being analyzed');
        process.exit(1);
    }
    
    console.log('\n✅ PASS: All language types are being analyzed');
}

testMultiLanguageRouting().catch(console.error);