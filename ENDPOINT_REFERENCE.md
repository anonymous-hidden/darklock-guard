# Quick Reference: Fixed Endpoints

## Profile API Routes

### Working Endpoints (All require authentication)

```
GET    /platform/profile/api/overview
       → Returns user profile + plan info

PUT    /platform/profile/api/username
       Body: { username, password }
       → Change username with password verification

PUT    /platform/profile/api/email  
       Body: { email, password }
       → Change email with password verification

POST   /platform/profile/api/avatar
       Content-Type: multipart/form-data
       Field: avatar (image file, max 5MB Free / 50MB Pro)
       → Upload and process avatar

GET    /platform/profile/api/export
       [Requires Pro Plan]
       → Download complete account data as JSON

GET    /platform/profile/api/pgp-username
       → Get PGP username (returns null if not set)

GET    /platform/profile/api/plan
       → Get current plan and feature list

POST   /platform/profile/api/2fa/setup
       Body: { password }
       → Returns QR code and secret for 2FA setup

POST   /platform/profile/api/2fa/verify
       Body: { code }
       → Verify and enable 2FA

GET    /platform/profile/api/2fa/status
       → Check if 2FA is enabled
```

## Download Endpoints

```
GET    /platform/api/download/darklock-guard-installer?format=deb
       Formats: deb, tar, exe, msi
       → Download Darklock Guard installer
```

## Site Routes (Public)

```
GET    /site/privacy       → Privacy Policy
GET    /site/terms         → Terms of Service
GET    /site/security      → Security Information
GET    /site/docs          → Documentation
GET    /site/status        → System Status
GET    /site/bug-report    → Bug Report Form
```

## Plan Enforcement

### Free Plan Limits
- 3 max sessions
- 2 max devices
- 5MB file uploads
- No data export
- Basic features only

### Pro Plan Features
- 10 max sessions
- 5 max devices
- 50MB file uploads
- ✅ Data export
- ✅ API access
- ✅ Priority support
- All features unlocked

### Error Responses
```json
{
  "success": false,
  "error": "This feature requires a Pro plan",
  "requiresPro": true,
  "currentPlan": "free",
  "upgradeUrl": "/platform/premium"
}
```

## Testing Commands

### Test 2FA Setup
```bash
curl -X POST https://darklock.net/platform/profile/api/2fa/setup \
  -H "Content-Type: application/json" \
  -b "darklock_token=YOUR_TOKEN" \
  -d '{"password":"yourpassword"}'
```

### Test Username Change
```bash
curl -X PUT https://darklock.net/platform/profile/api/username \
  -H "Content-Type: application/json" \
  -b "darklock_token=YOUR_TOKEN" \
  -d '{"username":"newname","password":"yourpassword"}'
```

### Test Export (Pro Only)
```bash
curl https://darklock.net/platform/profile/api/export \
  -b "darklock_token=YOUR_TOKEN" \
  -o account-export.json
```

### Test Download
```bash
curl -O https://darklock.net/platform/api/download/darklock-guard-installer?format=deb
```

## Frontend Integration

### Check User Plan
```javascript
const response = await fetch('/platform/profile/api/plan', {
    credentials: 'include'
});
const { plan, features } = await response.json();

if (features.exportData) {
    // Show export button
}
```

### Handle Pro-Only Features
```javascript
try {
    const response = await fetch('/platform/profile/api/export', {
        credentials: 'include'
    });
    
    if (response.status === 403) {
        const data = await response.json();
        // Show upgrade prompt
        window.location.href = data.upgradeUrl;
    }
} catch (err) {
    console.error(err);
}
```

## File Locations

- Routes: `darklock/routes/profile.js`
- Middleware: `darklock/middleware/plan-enforcement.js`
- Server: `darklock/server.js`
- Frontend: `darklock/public/js/dashboard.js`
- Site Views: `src/dashboard/views/site/*.html`
- Downloads: `darklock/downloads/*.{deb,tar.gz,exe,msi}`

## Common Issues

### 404 Errors
- Verify route is registered in server.js
- Check middleware order (auth before routes)
- Confirm file paths exist

### 403 Errors (Plan Restricted)
- Expected for Free users on Pro features
- Check plan status: `/platform/profile/api/plan`
- Verify premium manager is working

### 503 on Downloads
- Check if file exists in `/downloads/` directory
- Review console logs for attempted paths
- Rebuild Tauri app if necessary

## Success Indicators

✅ 2FA QR code appears after password
✅ Username changes immediately after password verification
✅ Avatar upload shows new image within seconds
✅ Export downloads JSON file (Pro only)
✅ PGP username shows value or "Not set"
✅ Download starts immediately (or shows 404 with help)
✅ Site routes load without errors
✅ Free users see "Upgrade" prompts on Pro features
