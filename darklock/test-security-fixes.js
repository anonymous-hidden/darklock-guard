#!/usr/bin/env node
/**
 * Security Fixes Verification Script
 * Tests that critical security fixes are properly implemented
 * 
 * Run: node test-security-fixes.js
 */

const fs = require('fs');
const path = require('path');

console.log('');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('     DARKLOCK SECURITY VERIFICATION - CRITICAL FIXES CHECK');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('');

let passed = 0;
let failed = 0;

function test(name, condition, details) {
    if (condition) {
        console.log(`✅ PASS: ${name}`);
        passed++;
    } else {
        console.log(`❌ FAIL: ${name}`);
        if (details) console.log(`   └─ ${details}`);
        failed++;
    }
}

// ============================================================================
// TEST 1: Check for hardcoded JWT fallbacks
// ============================================================================
console.log('\n📋 TEST GROUP 1: JWT Secret Fallback Removal');
console.log('─'.repeat(60));

const filesToCheck = [
    'routes/auth.js',
    'routes/admin-auth.js',
    'server.js',
    'utils/database.js'
];

const dangerousPatterns = [
    /['"]darklock-secret-key/,
    /JWT_SECRET\s*\|\|\s*['"][^'"]+['"]/,
    /ADMIN_JWT_SECRET\s*\|\|\s*['"][^'"]+['"]/
];

filesToCheck.forEach(file => {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        let hasHardcodedFallback = false;
        
        dangerousPatterns.forEach(pattern => {
            if (pattern.test(content)) {
                hasHardcodedFallback = true;
            }
        });
        
        test(`No hardcoded JWT fallbacks in ${file}`, !hasHardcodedFallback, 
            hasHardcodedFallback ? 'Found hardcoded secret fallback pattern' : null);
    }
});

// ============================================================================
// TEST 2: Verify env-validator exists and is used
// ============================================================================
console.log('\n📋 TEST GROUP 2: Environment Validation');
console.log('─'.repeat(60));

const envValidatorPath = path.join(__dirname, 'utils/env-validator.js');
test('env-validator.js exists', fs.existsSync(envValidatorPath));

if (fs.existsSync(envValidatorPath)) {
    const envValidatorContent = fs.readFileSync(envValidatorPath, 'utf8');
    test('requireEnv function defined', envValidatorContent.includes('function requireEnv'));
    test('getJwtSecret function defined', envValidatorContent.includes('function getJwtSecret'));
    test('getAdminJwtSecret function defined', envValidatorContent.includes('function getAdminJwtSecret'));
    test('process.exit(1) on missing env', envValidatorContent.includes('process.exit(1)'));
    test('Minimum length validation (64 chars)', envValidatorContent.includes('minLength = 64') || envValidatorContent.includes('minLength: 64'));
}

// Check auth.js uses env-validator
const authPath = path.join(__dirname, 'routes/auth.js');
if (fs.existsSync(authPath)) {
    const authContent = fs.readFileSync(authPath, 'utf8');
    test('auth.js imports env-validator', 
        authContent.includes('require(\'../utils/env-validator\')') || 
        authContent.includes('require("../utils/env-validator")'));
}

// Check admin-auth.js uses env-validator
const adminAuthPath = path.join(__dirname, 'routes/admin-auth.js');
if (fs.existsSync(adminAuthPath)) {
    const adminAuthContent = fs.readFileSync(adminAuthPath, 'utf8');
    test('admin-auth.js imports env-validator', 
        adminAuthContent.includes('require(\'../utils/env-validator\')') || 
        adminAuthContent.includes('require("../utils/env-validator")'));
}

// ============================================================================
// TEST 3: CORS Configuration
// ============================================================================
console.log('\n📋 TEST GROUP 3: CORS Security');
console.log('─'.repeat(60));

const serverPath = path.join(__dirname, 'server.js');
if (fs.existsSync(serverPath)) {
    const serverContent = fs.readFileSync(serverPath, 'utf8');
    
    test('No "origin: true" CORS wildcard', !serverContent.includes('origin: true'));
    test('Uses allowedOrigins array', serverContent.includes('allowedOrigins'));
    test('Production origins defined', 
        serverContent.includes('darklock.net') || serverContent.includes('CORS_ORIGINS'));
}

// ============================================================================
// TEST 4: Admin Secret Separation
// ============================================================================
console.log('\n📋 TEST GROUP 4: Secret Separation');
console.log('─'.repeat(60));

if (fs.existsSync(envValidatorPath)) {
    const envValidatorContent = fs.readFileSync(envValidatorPath, 'utf8');
    test('Enforces different admin/user secrets', 
        envValidatorContent.includes('requireDifferentSecrets') || 
        envValidatorContent.includes('must be different'));
}

if (fs.existsSync(adminAuthPath)) {
    const adminAuthContent = fs.readFileSync(adminAuthPath, 'utf8');
    test('Admin routes use ADMIN_JWT_SECRET', adminAuthContent.includes('ADMIN_JWT_SECRET'));
}

// ============================================================================
// SUMMARY
// ============================================================================
console.log('\n');
console.log('═══════════════════════════════════════════════════════════════════');
console.log('                         VERIFICATION SUMMARY');
console.log('═══════════════════════════════════════════════════════════════════');
console.log(`   ✅ Passed: ${passed}`);
console.log(`   ❌ Failed: ${failed}`);
console.log('');

if (failed === 0) {
    console.log('   🎉 ALL SECURITY CHECKS PASSED!');
    console.log('');
    console.log('   ╔═══════════════════════════════════════════════════════════╗');
    console.log('   ║                                                           ║');
    console.log('   ║   🚀  GO  - Ready for production deployment              ║');
    console.log('   ║                                                           ║');
    console.log('   ╚═══════════════════════════════════════════════════════════╝');
} else {
    console.log('   ⚠️  SECURITY ISSUES DETECTED');
    console.log('');
    console.log('   ╔═══════════════════════════════════════════════════════════╗');
    console.log('   ║                                                           ║');
    console.log('   ║   🛑  NO-GO  - Do NOT deploy until issues are fixed      ║');
    console.log('   ║                                                           ║');
    console.log('   ╚═══════════════════════════════════════════════════════════╝');
}
console.log('');

process.exit(failed > 0 ? 1 : 0);
