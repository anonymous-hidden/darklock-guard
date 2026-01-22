# 🔒 File Tamper Protection System

A complete, production-ready file integrity monitoring and tamper protection system for your Discord bot.

## 🏗️ Architecture

```
/file-protection/
├── agent/
│   ├── hasher.js              # SHA-256 file hashing
│   ├── validator.js           # Integrity validation
│   ├── protector.js           # Tamper response engine
│   ├── watcher.js             # Real-time file monitoring
│   ├── anomaly-ai.js          # AI-powered anomaly detection
│   ├── baseline-generator.js  # Baseline creation tool
│   └── protected-files.json   # List of files to protect
├── config/
│   ├── baseline.json          # SHA-256 baseline hashes
│   ├── rules.json             # Protection rules
│   └── settings.json          # System settings
├── backups/                   # File backups
├── logs/                      # Tamper event logs
└── index.js                   # Main system controller
```

## 🚀 Quick Start

### 1. Generate Baseline

First, create SHA-256 hashes for all protected files:

```bash
node file-protection/agent/baseline-generator.js
```

This will:
- Hash all files listed in `protected-files.json`
- Create backups in `backups/`
- Save baseline to `config/baseline.json`

### 2. Start Protection

```javascript
const TamperProtectionSystem = require('./file-protection');

const tps = new TamperProtectionSystem({
    logger: console // or your custom logger
});

// Initialize and start
await tps.start();
```

### 3. Check Status

```javascript
tps.printStatus();
```

## 🛡️ Protection Modes

Configure in `config/rules.json`:

| Mode | Description | Use Case |
|------|-------------|----------|
| `alert-only` | Only log and alert | Development/testing |
| `auto-revert` | Automatically restore files | **Recommended for production** |
| `quarantine` | Move tampered files to quarantine | Investigation mode |
| `block-execution` | Terminate process immediately | Maximum security |

## 📋 Protected Files

Edit `agent/protected-files.json` to specify which files to protect:

```json
[
  "D:\\discord bot\\src\\bot.js",
  "D:\\discord bot\\src\\dashboard\\dashboard.js",
  "D:\\discord bot\\src\\database\\database.js",
  "D:\\discord bot\\config.json",
  "D:\\discord bot\\package.json"
]
```

## 🔄 Integration with Bot

Add to your `src/bot.js`:

```javascript
const TamperProtectionSystem = require('./file-protection');

// Initialize protection system
const tamperProtection = new TamperProtectionSystem({
    logger: logger // Use your bot's logger
});

// Start protection before bot initialization
(async () => {
    await tamperProtection.start();
    
    // Then start your bot
    await client.login(process.env.DISCORD_TOKEN);
})();

// Graceful shutdown
process.on('SIGINT', async () => {
    await tamperProtection.stop();
    process.exit(0);
});
```

## 🧪 Testing

### Test 1: Modify Protected File
```bash
# Modify a protected file
echo "// test" >> src/bot.js

# System should detect and auto-revert
```

### Test 2: Delete Protected File
```bash
# Delete a protected file
del src\bot.js

# System should detect and restore from backup
```

### Test 3: Check Logs
```bash
# View tamper logs
type file-protection\logs\tamper-*.json
```

## 🤖 AI Anomaly Detection

The system includes pattern-based anomaly detection that analyzes:
- Critical file modifications
- Suspicious timing (2-5 AM changes)
- Rapid successive changes
- Complete file replacements
- File deletions

AI analysis provides:
- Threat level assessment
- Confidence scores
- Recommended actions
- Pattern indicators

## 📊 Monitoring

### View Status
```javascript
const status = tps.getStatus();
console.log(status);
```

### Print Dashboard
```javascript
tps.printStatus();
```

### Access Statistics
```javascript
const stats = tps.stats;
console.log(`Tampers Detected: ${stats.tampersDetected}`);
console.log(`Auto-Reverts: ${stats.autoReverts}`);
```

## ⚙️ Configuration

### Settings (`config/settings.json`)
```json
{
  "enabled": true,
  "mode": "auto-revert",
  "watcherEnabled": true,
  "debounceDelay": 100,
  "validateOnStartup": true,
  "logRetentionDays": 30,
  "backupRetentionDays": 7
}
```

### Rules (`config/rules.json`)
```json
{
  "mode": "auto-revert",
  "alertOnTamper": true,
  "blockExecution": false,
  "createBackups": true,
  "allowedProcesses": []
}
```

## 🔧 Maintenance

### Regenerate Baseline (After Legitimate Updates)
```bash
node file-protection/agent/baseline-generator.js
```

**⚠️ IMPORTANT:** Always regenerate baseline after legitimate code updates!

### Clean Old Logs
```javascript
// Logs older than 30 days are automatically managed
// Manual cleanup:
const fs = require('fs');
const path = require('path');

const logDir = './file-protection/logs';
const files = fs.readdirSync(logDir);
// ... cleanup logic
```

### Clean Old Backups
Similar to logs, manage backup retention via `settings.json`.

## 🚨 Security Best Practices

1. **Keep backups separate** - Store backups on different storage
2. **Regenerate baseline manually** - Never auto-update baseline
3. **Monitor logs regularly** - Check for tampering attempts
4. **Use block-execution mode in production** - For critical deployments
5. **Secure the protection system** - Protect these files too!

## 📝 Logs

Tamper events are logged in JSON format:

```json
{
  "timestamp": "2025-12-08T10:30:00.000Z",
  "file": "D:\\discord bot\\src\\bot.js",
  "reason": "hash_mismatch",
  "severity": "critical",
  "expectedHash": "bbd93e23...",
  "currentHash": "824953df...",
  "action": "auto-revert",
  "processId": 12345,
  "success": true
}
```

## 🐛 Troubleshooting

### Watcher Not Starting
- Ensure `chokidar` is installed: `npm install chokidar`
- Check file paths in `protected-files.json`
- Verify baseline exists

### Auto-Revert Failing
- Check backup directory exists
- Ensure sufficient disk space
- Verify file permissions

### False Positives
- Increase `debounceDelay` in settings
- Exclude temporary files
- Check for legitimate auto-formatting

## 📦 Dependencies

```bash
npm install chokidar
```

Built-in Node.js modules used:
- `crypto` (SHA-256 hashing)
- `fs` (file operations)
- `path` (path handling)

## 🎯 Production Checklist

- [ ] Generate baseline for all critical files
- [ ] Set mode to `auto-revert` or `block-execution`
- [ ] Enable `validateOnStartup`
- [ ] Configure log retention
- [ ] Set up backup storage
- [ ] Test tamper detection
- [ ] Monitor logs regularly
- [ ] Document baseline regeneration process

## 🆘 Support

For issues or questions:
1. Check logs in `file-protection/logs/`
2. Verify baseline integrity
3. Review configuration files
4. Test with a non-critical file first

---

**Version:** 1.0.0
**Status:** Production Ready ✅
**Last Updated:** December 8, 2025
