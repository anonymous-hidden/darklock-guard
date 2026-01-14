const { EmbedBuilder } = require('discord.js');

/**
 * Enhanced Behavioral AI System
 * Detects grooming, threats, racism, violence, self-harm, and patterns
 */
class BehaviorAnalysis {
    constructor(database, client) {
        this.db = database;
        this.client = client;
        this.openaiApiKey = process.env.OPENAI_API_KEY;
        
        // Pattern-based detection (fallback when AI unavailable)
        this.patterns = {
            selfHarm: [
                /\b(kill|hurt|cut|suicide|end it all|kms|hanging|overdose)\s+(myself|me)\b/i,
                /\b(want to|going to|gonna)\s+(die|kill myself)\b/i,
                /\b(self harm|self-harm|cutting|slitting)\b/i
            ],
            violence: [
                /\b(kill|murder|shoot|stab|beat|assault)\s+(you|him|her|them)\b/i,
                /\b(gonna|going to|will)\s+(kill|hurt|beat)\b/i,
                /\b(bomb|terrorist|attack|massacre)\b/i
            ],
            grooming: [
                /\b(send\s+)?(nudes|pics|pictures)\s+(of|to)\b/i,
                /\b(how old are you|what's your age|age\?)\b/i,
                /\b(meet\s+up|hang\s+out)\s+(alone|private)\b/i,
                /\b(don't tell|keep it secret|between us)\b/i
            ],
            hate: [
                /\b(n[i1!]gg[ae3]r|f[a@]gg[o0]t|r[e3]t[a@]rd|tr[a@]nn[yi1])\b/i,
                /\b(k[yi1]k[e3]|sp[i1]c|ch[i1]nk)\b/i
            ],
            threats: [
                /\b(swat|dox|leak|expose)\s+(you|your|him|her)\b/i,
                /\b(know where you live|find you|coming for you)\b/i
            ],
            spam: [
                /(.)\1{20,}/,  // Character repetition
                /@everyone|@here/i,
                /(?:https?:\/\/[^\s]+.*?){5,}/  // Multiple links
            ]
        };

        this.userBehaviorCache = new Map();
    }

    /**
     * Analyze message content using AI + patterns
     */
    async analyzeMessage(message) {
        const content = message.content.toLowerCase();
        const results = {
            threats: [],
            scores: {},
            actions: [],
            shouldFlag: false,
            shouldDelete: false,
            shouldNotifyMods: false
        };

        // Pattern-based detection (always runs)
        const patternResults = await this.runPatternDetection(content);
        results.threats = results.threats.concat(patternResults.threats);
        results.scores = { ...patternResults.scores };

        // AI-based detection (if API key available)
        if (this.openaiApiKey) {
            try {
                const aiResults = await this.runAIDetection(content);
                results.threats = results.threats.concat(aiResults.threats);
                Object.assign(results.scores, aiResults.scores);
            } catch (error) {
                console.error('AI detection failed, using patterns only:', error);
            }
        }

        // Determine actions based on threat scores
        results.shouldFlag = Object.values(results.scores).some(score => score > 0.6);
        results.shouldDelete = Object.values(results.scores).some(score => score > 0.8);
        results.shouldNotifyMods = Object.values(results.scores).some(score => score > 0.7);

        // Log to database
        if (results.shouldFlag) {
            await this.logBehaviorAnalysis(
                message.guild.id,
                message.author.id,
                results.threats.join(', '),
                content,
                Math.max(...Object.values(results.scores)),
                results.threats
            );
        }

        // Update user behavior score
        await this.updateUserBehaviorScore(message.guild.id, message.author.id, results);

        return results;
    }

    /**
     * Pattern-based detection
     */
    async runPatternDetection(content) {
        const threats = [];
        const scores = {
            selfHarm: 0,
            violence: 0,
            grooming: 0,
            hate: 0,
            threats: 0,
            spam: 0
        };

        for (const [category, patterns] of Object.entries(this.patterns)) {
            for (const pattern of patterns) {
                if (pattern.test(content)) {
                    threats.push(category);
                    scores[category] = Math.min(scores[category] + 0.3, 1.0);
                }
            }
        }

        return { threats: [...new Set(threats)], scores };
    }

    /**
     * AI-based detection using OpenAI
     */
    async runAIDetection(content) {
        if (!this.openaiApiKey) {
            return { threats: [], scores: {} };
        }

        try {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.openaiApiKey}`
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [
                        {
                            role: 'system',
                            content: `You are a content moderation AI. Analyze the following message and return ONLY a JSON object with threat scores (0-1) for these categories: selfHarm, violence, grooming, hate, threats, spam. Higher score = more concerning. Be strict but fair.`
                        },
                        {
                            role: 'user',
                            content: content
                        }
                    ],
                    max_tokens: 150,
                    temperature: 0.3
                })
            });

            const data = await response.json();
            const aiResponse = data.choices[0].message.content;
            
            // Parse JSON response
            const scores = JSON.parse(aiResponse);
            const threats = Object.entries(scores)
                .filter(([_, score]) => score > 0.6)
                .map(([category, _]) => category);

            return { threats, scores };
        } catch (error) {
            console.error('AI detection error:', error);
            return { threats: [], scores: {} };
        }
    }

    /**
     * Log behavior analysis to database
     */
    async logBehaviorAnalysis(guildId, userId, analysisType, contentSample, threatScore, categories) {
        await this.db.run(`
            INSERT INTO behavior_analysis (
                guild_id, user_id, analysis_type,
                content_sample, threat_score, threat_categories,
                confidence
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            guildId,
            userId,
            analysisType,
            contentSample.substring(0, 500),
            threatScore,
            JSON.stringify(categories),
            threatScore // Using threat score as confidence
        ]);
    }

    /**
     * Update user's behavior score over time
     */
    async updateUserBehaviorScore(guildId, userId, analysisResults) {
        const record = await this.db.get(`
            SELECT * FROM user_records WHERE guild_id = ? AND user_id = ?
        `, [guildId, userId]);

        if (!record) {
            // Create new record
            await this.db.run(`
                INSERT INTO user_records (
                    guild_id, user_id, behavior_score, pattern_flags
                ) VALUES (?, ?, ?, ?)
            `, [guildId, userId, 50, JSON.stringify(analysisResults.threats)]);
            return;
        }

        // Update existing record
        const currentScore = record.behavior_score || 50;
        const maxThreatScore = Math.max(...Object.values(analysisResults.scores));
        
        // Decrease score if threats detected
        let newScore = currentScore;
        if (maxThreatScore > 0.6) {
            newScore = Math.max(0, currentScore - (maxThreatScore * 20));
        } else {
            // Slowly recover score over time
            newScore = Math.min(100, currentScore + 1);
        }

        await this.db.run(`
            UPDATE user_records
            SET behavior_score = ?, pattern_flags = ?, updated_at = CURRENT_TIMESTAMP
            WHERE guild_id = ? AND user_id = ?
        `, [
            Math.round(newScore),
            JSON.stringify(analysisResults.threats),
            guildId,
            userId
        ]);
    }

    /**
     * Get user's behavior history
     */
    async getUserBehaviorHistory(guildId, userId, limit = 20) {
        return await this.db.all(`
            SELECT * FROM behavior_analysis
            WHERE guild_id = ? AND user_id = ?
            ORDER BY timestamp DESC
            LIMIT ?
        `, [guildId, userId, limit]);
    }

    /**
     * Detect user behavior patterns over time
     */
    async detectBehaviorPatterns(guildId, userId) {
        const history = await this.getUserBehaviorHistory(guildId, userId, 100);
        
        if (history.length < 5) {
            return { detected: false, patterns: [] };
        }

        const patterns = {
            escalating: false,
            repetitive: false,
            multiCategory: false
        };

        // Check for escalating behavior
        const recentScores = history.slice(0, 10).map(h => h.threat_score);
        const avgRecent = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
        const olderScores = history.slice(10, 30).map(h => h.threat_score);
        const avgOlder = olderScores.reduce((a, b) => a + b, 0) / olderScores.length;
        
        if (avgRecent > avgOlder * 1.5) {
            patterns.escalating = true;
        }

        // Check for repetitive threats
        const categories = history.map(h => h.analysis_type);
        const categoryCount = {};
        categories.forEach(cat => {
            categoryCount[cat] = (categoryCount[cat] || 0) + 1;
        });
        
        if (Object.values(categoryCount).some(count => count > 5)) {
            patterns.repetitive = true;
        }

        // Check for multi-category violations
        if (Object.keys(categoryCount).length >= 3) {
            patterns.multiCategory = true;
        }

        return {
            detected: Object.values(patterns).some(p => p),
            patterns,
            history: history.slice(0, 5)
        };
    }

    /**
     * Send safety alert to moderators
     */
    async sendSafetyAlert(guild, message, analysisResults) {
        const config = await this.db.getGuildConfig(guild.id);
        if (!config?.log_channel_id) return;

        const logChannel = guild.channels.cache.get(config.log_channel_id);
        if (!logChannel) return;

        const embed = new EmbedBuilder()
            .setTitle('⚠️ Concerning Content Detected')
            .setColor(0xFF0000)
            .setDescription(`**User:** ${message.author.tag} (${message.author.id})\n**Channel:** ${message.channel}`)
            .addFields(
                { name: 'Threat Categories', value: analysisResults.threats.join(', ') || 'None', inline: true },
                { name: 'Max Score', value: `${(Math.max(...Object.values(analysisResults.scores)) * 100).toFixed(0)}%`, inline: true },
                { name: 'Content Preview', value: message.content.substring(0, 500) }
            )
            .setTimestamp();

        if (analysisResults.shouldDelete) {
            embed.addFields({ name: '🗑️ Action', value: 'Message auto-deleted' });
        }

        await logChannel.send({ embeds: [embed] });

        // Log to safety_alerts table
        await this.db.run(`
            INSERT INTO safety_alerts (
                guild_id, user_id, channel_id, message_id,
                alert_type, content_sample, confidence,
                moderator_notified
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `, [
            guild.id,
            message.author.id,
            message.channel.id,
            message.id,
            analysisResults.threats.join(','),
            message.content.substring(0, 500),
            Math.max(...Object.values(analysisResults.scores))
        ]);
    }

    /**
     * Send intervention message for self-harm detection
     */
    async sendSelfHarmIntervention(message) {
        try {
            const embed = new EmbedBuilder()
                .setTitle('💙 We Care About You')
                .setDescription(
                    `It looks like you might be going through a difficult time. Please know that you're not alone, and there are people who want to help.\n\n` +
                    `**Crisis Resources:**\n` +
                    `🇺🇸 National Suicide Prevention Lifeline: 988\n` +
                    `🇬🇧 Samaritans: 116 123\n` +
                    `🌍 International: [findahelpline.com](https://findahelpline.com)\n\n` +
                    `Please reach out to someone you trust or contact a crisis helpline. Your life matters.`
                )
                .setColor(0x5865F2)
                .setFooter({ text: 'This is an automated message from our safety system' });

            await message.author.send({ embeds: [embed] }).catch(() => {});

            // Log intervention
            await this.db.run(`
                UPDATE safety_alerts
                SET intervention_sent = 1, intervention_type = 'self_harm'
                WHERE guild_id = ? AND user_id = ? AND message_id = ?
            `, [message.guild.id, message.author.id, message.id]);
        } catch (error) {
            console.error('Failed to send self-harm intervention:', error);
        }
    }
}

module.exports = BehaviorAnalysis;
