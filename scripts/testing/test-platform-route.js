const http = require('http');

// Test the /platform route
http.get('http://localhost:3000/platform', (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
        data += chunk;
    });
    
    res.on('end', () => {
        console.log('Status Code:', res.statusCode);
        console.log('Content-Type:', res.headers['content-type']);
        
        if (res.statusCode === 200) {
            console.log('✅ SUCCESS: /platform route is working!');
            console.log('Response preview (first 500 chars):');
            console.log(data.substring(0, 500));
        } else if (res.statusCode === 404) {
            console.log('❌ ERROR: 404 Not Found');
            console.log('Response:', data);
        } else {
            console.log('⚠️ Unexpected status code:', res.statusCode);
            console.log('Response:', data);
        }
    });
}).on('error', (err) => {
    console.error('❌ Connection error:', err.message);
    console.log('Make sure the bot is running on port 3000');
});
