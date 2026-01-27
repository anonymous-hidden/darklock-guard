// Simple test script to check /platform route
const http = require('http');

console.log('Testing http://localhost:3000/platform...\n');

const req = http.get('http://localhost:3000/platform', (res) => {
    console.log(`Status Code: ${res.statusCode}`);
    console.log(`Headers:`, res.headers);
    
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    
    res.on('end', () => {
        if (res.statusCode === 200) {
            console.log('\n✅ SUCCESS! /platform is working');
            console.log(`Response length: ${data.length} bytes`);
            console.log(`First 300 chars: ${data.substring(0, 300)}...`);
        } else if (res.statusCode === 404) {
            console.log('\n❌ FAILED! Got 404 error');
            console.log('Response:', data);
        } else {
            console.log(`\n⚠️  Got status ${res.statusCode}`);
            console.log('Response:', data.substring(0, 500));
        }
    });
});

req.on('error', (err) => {
    console.error('❌ Connection error:', err.message);
    console.log('Make sure the bot is running on port 3000');
});

req.end();
