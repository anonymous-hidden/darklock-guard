const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Authentication & Permission Audit
 * Tracks all authentication attempts and permission changes
 */
class AuthenticationAuditor {
    constructor(options = {}) {
        this.logger = options.logger || console;
        this.enabled = options.enabled !== false;
        this.auditLog = [];
        this.failedAttempts = new Map();
        this.maxFailedAttempts = options.maxFailedAttempts || 5;
        this.lockoutDuration = options.lockoutDuration || 900000; // 15 minutes
        this.suspiciousIPs = new Set();
        this.maxLogEntries = 10000;
    }

    /**
     * Log authentication attempt
     */
    logAuthAttempt(userId, username, ip, success, method = 'unknown') {
        const entry = {
            timestamp: new Date().toISOString(),
            userId: userId,
            username: username,
            ip: ip,
            success: success,
            method: method,
            userAgent: null
        };

        this.auditLog.push(entry);

        if (this.auditLog.length > this.maxLogEntries) {
            this.auditLog.shift();
        }

        // Track failed attempts
        if (!success) {
            const key = `${ip}:${userId}`;
            const attempts = (this.failedAttempts.get(key) || 0) + 1;
            this.failedAttempts.set(key, attempts);

            if (attempts >= this.maxFailedAttempts) {
                this.suspiciousIPs.add(ip);
                this.logger.error(`[Auth Auditor] 🚨 IP LOCKED: Too many failed attempts from ${ip}`);

                setTimeout(() => {
                    this.suspiciousIPs.delete(ip);
                }, this.lockoutDuration);
            }
        } else {
            // Clear failed attempts on success
            const key = `${ip}:${userId}`;
            this.failedAttempts.delete(key);
        }

        return entry;
    }

    /**
     * Log permission change
     */
    logPermissionChange(adminId, targetUser, permission, action, reason = '') {
        const entry = {
            timestamp: new Date().toISOString(),
            type: 'permission-change',
            adminId: adminId,
            targetUser: targetUser,
            permission: permission,
            action: action, // 'grant' or 'revoke'
            reason: reason
        };

        this.auditLog.push(entry);

        if (this.auditLog.length > this.maxLogEntries) {
            this.auditLog.shift();
        }

        this.logger.log(`[Auth Auditor] Permission ${action}: ${permission} for ${targetUser}`);
        return entry;
    }

    /**
     * Check if IP is locked out
     */
    isIPLocked(ip) {
        return this.suspiciousIPs.has(ip);
    }

    /**
     * Detect brute force attacks
     */
    detectBruteForce() {
        const attacks = [];

        for (const [key, attempts] of this.failedAttempts.entries()) {
            if (attempts >= this.maxFailedAttempts) {
                const [ip, userId] = key.split(':');
                attacks.push({
                    type: 'brute-force',
                    ip: ip,
                    userId: userId,
                    attempts: attempts,
                    severity: 'high'
                });
            }
        }

        return attacks;
    }

    /**
     * Detect unusual login patterns
     */
    detectUnusualPatterns() {
        const patterns = [];
        const recentAttempts = this.auditLog.filter(e => 
            new Date() - new Date(e.timestamp) < 3600000 // Last hour
        );

        // Check for multiple logins from different IPs
        const ips = new Set(recentAttempts.map(a => a.ip));
        if (ips.size > 5) {
            patterns.push({
                type: 'multiple-ips',
                uniqueIPs: ips.size,
                timeframe: '1 hour',
                severity: 'high'
            });
        }

        // Check for logins at unusual times
        const now = new Date();
        const hour = now.getHours();
        if (hour >= 2 && hour <= 5) {
            const suspiciousLogins = recentAttempts.filter(a => 
                a.success && new Date(a.timestamp).getHours() >= 2 && new Date(a.timestamp).getHours() <= 5
            );
            if (suspiciousLogins.length > 2) {
                patterns.push({
                    type: 'unusual-time-logins',
                    count: suspiciousLogins.length,
                    timeframe: '2-5 AM',
                    severity: 'medium'
                });
            }
        }

        return patterns;
    }

    /**
     * Generate security report
     */
    getSecurityReport() {
        return {
            totalAuthAttempts: this.auditLog.filter(e => e.method).length,
            successfulLogins: this.auditLog.filter(e => e.success).length,
            failedAttempts: this.auditLog.filter(e => !e.success && e.method).length,
            bruteForceAttacks: this.detectBruteForce(),
            unusualPatterns: this.detectUnusualPatterns(),
            lockedIPs: Array.from(this.suspiciousIPs),
            permissionChanges: this.auditLog.filter(e => e.type === 'permission-change'),
            recentActivity: this.auditLog.slice(-50)
        };
    }
}

module.exports = AuthenticationAuditor;
