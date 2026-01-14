const fs = require('fs');
const path = require('path');

/**
 * AI-Powered Anomaly Detector
 * Analyzes file changes for suspicious patterns
 */
class AnomalyDetector {
    constructor(options = {}) {
        this.logger = options.logger || console;
        this.enabled = options.enabled !== false;
        this.aiClient = options.aiClient || null;
    }

    /**
     * Analyze file modification for anomalies
     * @param {Object} tamperData - Tamper detection data
     * @returns {Object} Analysis result
     */
    async analyze(tamperData) {
        if (!this.enabled) {
            return {
                analyzed: false,
                reason: 'AI analysis disabled'
            };
        }

        try {
            const analysis = {
                timestamp: new Date().toISOString(),
                file: tamperData.filePath,
                threatLevel: 'unknown',
                confidence: 0,
                indicators: [],
                recommendation: 'manual-review'
            };

            // Pattern-based detection (rule-based AI)
            const patterns = this.detectPatterns(tamperData);
            analysis.indicators = patterns.indicators;
            analysis.threatLevel = patterns.threatLevel;
            analysis.confidence = patterns.confidence;

            // Determine recommendation
            if (patterns.threatLevel === 'critical') {
                analysis.recommendation = 'block-immediately';
            } else if (patterns.threatLevel === 'high') {
                analysis.recommendation = 'revert-and-alert';
            } else if (patterns.threatLevel === 'medium') {
                analysis.recommendation = 'alert-only';
            } else {
                analysis.recommendation = 'log-only';
            }

            // If external AI is available, enhance analysis
            if (this.aiClient) {
                const aiAnalysis = await this.queryAI(tamperData);
                if (aiAnalysis) {
                    analysis.aiEnhanced = true;
                    analysis.aiThreatLevel = aiAnalysis.threatLevel;
                    analysis.aiReasoning = aiAnalysis.reasoning;
                }
            }

            this.logger.log('[AI] Analysis complete:', analysis);
            return analysis;

        } catch (error) {
            this.logger.error('[AI] Analysis failed:', error.message);
            return {
                analyzed: false,
                error: error.message
            };
        }
    }

    /**
     * Pattern-based threat detection
     * @param {Object} tamperData - Tamper data
     * @returns {Object} Pattern analysis
     */
    detectPatterns(tamperData) {
        const indicators = [];
        let threatLevel = 'low';
        let confidence = 0.5;

        const { filePath, reason, currentHash, expectedHash } = tamperData;

        // Critical file modification
        const criticalFiles = ['bot.js', 'dashboard.js', 'database.js', 'config.json'];
        if (criticalFiles.some(f => filePath.includes(f))) {
            indicators.push('critical-file-modified');
            threatLevel = 'high';
            confidence += 0.2;
        }

        // File deletion
        if (reason === 'file_missing') {
            indicators.push('file-deleted');
            threatLevel = 'critical';
            confidence += 0.3;
        }

        // Hash completely different (not just minor edit)
        if (expectedHash && currentHash) {
            const similarity = this.compareHashes(expectedHash, currentHash);
            if (similarity < 0.1) {
                indicators.push('complete-file-replacement');
                threatLevel = 'critical';
                confidence += 0.3;
            }
        }

        // Time-based anomalies
        const hour = new Date().getHours();
        if (hour >= 2 && hour <= 5) {
            indicators.push('suspicious-time-modification');
            confidence += 0.1;
        }

        // Rapid successive changes
        if (this.recentChanges && this.recentChanges.length > 3) {
            indicators.push('rapid-file-changes');
            threatLevel = threatLevel === 'low' ? 'medium' : 'high';
            confidence += 0.15;
        }

        confidence = Math.min(confidence, 1.0);

        return {
            indicators,
            threatLevel,
            confidence,
            patterns: indicators.length
        };
    }

    /**
     * Compare hash similarity (simple implementation)
     * @param {string} hash1
     * @param {string} hash2
     * @returns {number} Similarity score (0-1)
     */
    compareHashes(hash1, hash2) {
        if (!hash1 || !hash2) return 0;
        
        let matches = 0;
        const length = Math.min(hash1.length, hash2.length);
        
        for (let i = 0; i < length; i++) {
            if (hash1[i] === hash2[i]) matches++;
        }
        
        return matches / length;
    }

    /**
     * Query external AI service (GPT/Claude)
     * @param {Object} tamperData - Tamper data
     * @returns {Object} AI analysis
     */
    async queryAI(tamperData) {
        if (!this.aiClient) return null;

        try {
            const prompt = `
Analyze the following file tampering event for security threat level:

FILE: ${tamperData.filePath}
REASON: ${tamperData.reason}
SEVERITY: ${tamperData.severity}
EXPECTED HASH: ${tamperData.expectedHash}
CURRENT HASH: ${tamperData.currentHash}
TIMESTAMP: ${new Date().toISOString()}

Respond with JSON:
{
    "threatLevel": "low|medium|high|critical",
    "reasoning": "brief explanation",
    "confidence": 0.0-1.0
}
`;

            // Mock AI response (replace with actual AI API call)
            // Example: const response = await this.aiClient.generate({ prompt });
            
            return {
                threatLevel: 'high',
                reasoning: 'Critical file modification detected',
                confidence: 0.85
            };

        } catch (error) {
            this.logger.error('[AI] Query failed:', error.message);
            return null;
        }
    }

    /**
     * Track recent changes for pattern detection
     * @param {string} filePath - Modified file
     */
    trackChange(filePath) {
        if (!this.recentChanges) {
            this.recentChanges = [];
        }

        this.recentChanges.push({
            file: filePath,
            timestamp: Date.now()
        });

        // Keep only last 10 changes
        if (this.recentChanges.length > 10) {
            this.recentChanges.shift();
        }

        // Clear old changes (older than 5 minutes)
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        this.recentChanges = this.recentChanges.filter(c => c.timestamp > fiveMinutesAgo);
    }

    /**
     * Generate security report
     * @returns {Object} Security report
     */
    generateReport() {
        return {
            enabled: this.enabled,
            recentChanges: this.recentChanges?.length || 0,
            status: 'active'
        };
    }
}

module.exports = AnomalyDetector;
