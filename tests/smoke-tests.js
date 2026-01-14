/**
 * Smoke Tests for Darklock Platform
 * Run these after deployment to verify critical functionality
 * 
 * Usage: node tests/smoke-tests.js
 */

const axios = require('axios');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3001';

// Test results
const results = {
    passed: [],
    failed: []
};

/**
 * Test helper
 */
async function test(name, fn) {
    try {
        await fn();
        results.passed.push(name);
        console.log(`✅ ${name}`);
    } catch (err) {
        results.failed.push({ name, error: err.message });
        console.error(`❌ ${name}: ${err.message}`);
    }
}

/**
 * Run all smoke tests
 */
async function runTests() {
    console.log('🔥 Running Darklock Platform Smoke Tests...\n');
    console.log(`Target: ${BASE_URL}\n`);
    
    // Test 1: Health endpoint
    await test('Health endpoint returns 200', async () => {
        const res = await axios.get(`${BASE_URL}/platform/api/health`);
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        if (res.data.status !== 'healthy') throw new Error(`Status not healthy: ${res.data.status}`);
    });
    
    // Test 2: Homepage loads
    await test('Homepage loads without errors', async () => {
        const res = await axios.get(`${BASE_URL}/platform`);
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        if (!res.data.includes('Darklock')) throw new Error('Page content missing Darklock branding');
    });
    
    // Test 3: Login page loads
    await test('Login page loads', async () => {
        const res = await axios.get(`${BASE_URL}/platform/auth/login`, {
            maxRedirects: 0,
            validateStatus: (status) => status < 500
        });
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    });
    
    // Test 4: Signup page loads
    await test('Signup page loads', async () => {
        const res = await axios.get(`${BASE_URL}/platform/auth/signup`, {
            maxRedirects: 0,
            validateStatus: (status) => status < 500
        });
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    });
    
    // Test 5: Auth/me returns 401 when not logged in
    await test('Auth/me returns 401 for unauthenticated requests', async () => {
        try {
            await axios.get(`${BASE_URL}/platform/auth/me`);
            throw new Error('Should have returned 401');
        } catch (err) {
            if (err.response?.status !== 401) {
                throw new Error(`Expected 401, got ${err.response?.status || 'unknown'}`);
            }
        }
    });
    
    // Test 6: Dashboard redirects when not authenticated
    await test('Dashboard redirects unauthenticated users', async () => {
        const res = await axios.get(`${BASE_URL}/platform/dashboard`, {
            maxRedirects: 0,
            validateStatus: (status) => status < 500
        });
        if (res.status !== 302 && res.status !== 200) {
            throw new Error(`Expected 302 or 200, got ${res.status}`);
        }
    });
    
    // Test 7: Rate limiting on signup
    await test('Signup endpoint exists and validates input', async () => {
        try {
            await axios.post(`${BASE_URL}/platform/auth/signup`, {
                username: 'test',
                email: 'invalid-email',
                password: '123'
            });
            throw new Error('Should have returned validation error');
        } catch (err) {
            if (err.response?.status !== 400) {
                throw new Error(`Expected 400 validation error, got ${err.response?.status || 'unknown'}`);
            }
        }
    });
    
    // Test 8: Static assets load
    await test('Static assets are accessible', async () => {
        const res = await axios.get(`${BASE_URL}/platform/static/css/main.css`, {
            validateStatus: (status) => status < 500
        });
        if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
    });
    
    // Print summary
    console.log('\n' + '='.repeat(50));
    console.log('SMOKE TEST SUMMARY');
    console.log('='.repeat(50));
    console.log(`✅ Passed: ${results.passed.length}`);
    console.log(`❌ Failed: ${results.failed.length}`);
    
    if (results.failed.length > 0) {
        console.log('\nFailed Tests:');
        results.failed.forEach(({ name, error }) => {
            console.log(`  - ${name}: ${error}`);
        });
        process.exit(1);
    } else {
        console.log('\n🎉 All smoke tests passed!');
        process.exit(0);
    }
}

// Run tests
runTests().catch(err => {
    console.error('Fatal error running tests:', err);
    process.exit(1);
});
