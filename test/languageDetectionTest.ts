import * as path from 'path';

function detectLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.py') return 'python';
    if (ext === '.cs') return 'csharp';
    if (ext === '.ts' || ext === '.tsx') return 'typescript';
    if (ext === '.js' || ext === '.jsx') return 'javascript';
    return 'unknown';
}

// Test language detection
const testCases = [
    { file: 'test.py', expected: 'python' },
    { file: 'test.cs', expected: 'csharp' },
    { file: 'test.ts', expected: 'typescript' },
    { file: 'test.tsx', expected: 'typescript' },
    { file: 'test.js', expected: 'javascript' },
    { file: 'test.jsx', expected: 'javascript' },
    { file: 'test.txt', expected: 'unknown' },
    { file: 'test.java', expected: 'unknown' },
    { file: 'test.cpp', expected: 'unknown' },
];

console.log('=== Language Detection Tests ===');
let passed = 0;
let failed = 0;

for (const tc of testCases) {
    const result = detectLanguage(tc.file);
    if (result === tc.expected) {
        console.log(`✅ ${tc.file} -> ${result}`);
        passed++;
    } else {
        console.log(`❌ ${tc.file} -> ${result} (expected: ${tc.expected})`);
        failed++;
    }
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed > 0) {
    process.exit(1);
}

console.log('\n✅ All language detection tests passed!');
