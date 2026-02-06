/**
 * Enterprise Services Test Suite
 * Tests for ModerationQueue, ConfigService, VerificationService, SecurityMiddleware
 */

// Mock Discord.js structures
const mockUser = {
    id: '123456789012345678',
    tag: 'TestUser#0001',
    username: 'TestUser',
    displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
    createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days old
    createdTimestamp: Date.now() - 30 * 24 * 60 * 60 * 1000
};

const mockMember = {
    id: '123456789012345678',
    user: mockUser,
    guild: { id: '987654321098765432', name: 'Test Server' },
    roles: {
        cache: new Map(),
        add: async () => true,
        remove: async () => true,
        highest: { position: 5 }
    },
    kick: async () => true,
    ban: async () => true,
    timeout: async () => true,
    send: async () => true,
    permissions: {
        has: () => false
    }
};

const mockGuild = {
    id: '987654321098765432',
    name: 'Test Server',
    ownerId: '111111111111111111',
    members: {
        me: {
            roles: { highest: { position: 10 } },
            permissions: { has: () => true }
        },
        fetch: async () => mockMember
    },
    roles: {
        cache: new Map([
            ['111', { id: '111', name: 'Verified' }],
            ['222', { id: '222', name: 'Unverified' }]
        ])
    },
    channels: {
        cache: new Map()
    }
};

const mockInteraction = {
    user: mockUser,
    member: mockMember,
    guild: mockGuild,
    commandName: 'test',
    options: {
        data: [],
        getUser: () => null,
        getString: () => null
    },
    customId: 'verify_button',
    components: [],
    reply: async () => true,
    deferReply: async () => true,
    editReply: async () => true,
    followUp: async () => true,
    showModal: async () => true
};

// Mock bot instance
const mockDatabase = {
    run: async () => true,
    get: async () => null,
    all: async () => [],
    getGuildConfig: async () => ({
        verification_enabled: 1,
        verification_method: 'button',
        verified_role_id: '111',
        unverified_role_id: '222'
    })
};

const mockLogger = {
    info: console.log,
    warn: console.warn,
    error: console.error,
    debug: () => {}
};

const mockBot = {
    database: mockDatabase,
    logger: mockLogger,
    client: {
        guilds: { cache: new Map([[mockGuild.id, mockGuild]]) }
    },
    dashboard: {
        broadcastToGuild: () => {}
    },
    forensicsManager: {
        logAuditEvent: async () => true
    },
    permissionManager: {
        isAllowed: async () => true
    }
};

// Test runner
class TestRunner {
    constructor() {
        this.tests = [];
        this.passed = 0;
        this.failed = 0;
    }

    test(name, fn) {
        this.tests.push({ name, fn });
    }

    async run() {
        console.log('\n🧪 Running Enterprise Services Tests...\n');
        console.log('═'.repeat(60));

        for (const test of this.tests) {
            try {
                await test.fn();
                console.log(`✅ ${test.name}`);
                this.passed++;
            } catch (error) {
                console.log(`❌ ${test.name}`);
                console.log(`   Error: ${error.message}`);
                this.failed++;
            }
        }

        console.log('═'.repeat(60));
        console.log(`\n📊 Results: ${this.passed} passed, ${this.failed} failed\n`);
        return this.failed === 0;
    }

    assertEqual(actual, expected, message = '') {
        if (actual !== expected) {
            throw new Error(`${message}: Expected ${expected}, got ${actual}`);
        }
    }

    assertTrue(value, message = '') {
        if (!value) {
            throw new Error(`${message}: Expected truthy value, got ${value}`);
        }
    }

    assertFalse(value, message = '') {
        if (value) {
            throw new Error(`${message}: Expected falsy value, got ${value}`);
        }
    }
}

const runner = new TestRunner();

// ─────────────────────────────────────────────────────────────
// SecurityMiddleware Tests
// ─────────────────────────────────────────────────────────────

runner.test('SecurityMiddleware: should initialize', () => {
    const SecurityMiddleware = require('../src/services/SecurityMiddleware');
    const middleware = new SecurityMiddleware(mockBot);
    runner.assertTrue(middleware, 'Middleware should exist');
});

runner.test('SecurityMiddleware: checkBlocked should pass for unblocked user', async () => {
    const SecurityMiddleware = require('../src/services/SecurityMiddleware');
    const middleware = new SecurityMiddleware(mockBot);
    const result = middleware.checkBlocked(mockInteraction);
    runner.assertTrue(result.passed, 'Should pass for unblocked user');
});

runner.test('SecurityMiddleware: blockUser should block user', async () => {
    const SecurityMiddleware = require('../src/services/SecurityMiddleware');
    const middleware = new SecurityMiddleware(mockBot);
    middleware.blockUser('testuser123');
    const result = middleware.checkBlocked({ user: { id: 'testuser123' } });
    runner.assertFalse(result.passed, 'Should fail for blocked user');
    runner.assertEqual(result.code, 'BLOCKED', 'Should return BLOCKED code');
});

runner.test('SecurityMiddleware: checkRateLimit should pass initially', () => {
    const SecurityMiddleware = require('../src/services/SecurityMiddleware');
    const middleware = new SecurityMiddleware(mockBot);
    const result = middleware.checkRateLimit(mockInteraction);
    runner.assertTrue(result.passed, 'Should pass initial rate limit check');
});

runner.test('SecurityMiddleware: isValidSnowflake should validate IDs', () => {
    const SecurityMiddleware = require('../src/services/SecurityMiddleware');
    const middleware = new SecurityMiddleware(mockBot);
    runner.assertTrue(middleware.isValidSnowflake('123456789012345678'), 'Valid 18-digit ID');
    runner.assertTrue(middleware.isValidSnowflake('12345678901234567890'), 'Valid 20-digit ID');
    runner.assertFalse(middleware.isValidSnowflake('123'), 'Invalid short ID');
    runner.assertFalse(middleware.isValidSnowflake('abc'), 'Invalid non-numeric ID');
});

runner.test('SecurityMiddleware: sanitize should escape mentions', () => {
    const SecurityMiddleware = require('../src/services/SecurityMiddleware');
    const middleware = new SecurityMiddleware(mockBot);
    const sanitized = middleware.sanitize('test @everyone @here test');
    runner.assertFalse(sanitized.includes('@everyone'), 'Should escape @everyone');
    runner.assertFalse(sanitized.includes('@here'), 'Should escape @here');
});

runner.test('SecurityMiddleware: checkInputValidation should block suspicious patterns', () => {
    const SecurityMiddleware = require('../src/services/SecurityMiddleware');
    const middleware = new SecurityMiddleware(mockBot);
    
    const badInteraction = {
        user: mockUser,
        options: {
            data: [{ value: 'Get free nitro at discord.gift/xyz' }]
        }
    };
    
    const result = middleware.checkInputValidation(badInteraction);
    runner.assertFalse(result.passed, 'Should block suspicious input');
});

// ─────────────────────────────────────────────────────────────
// ModerationQueue Tests
// ─────────────────────────────────────────────────────────────

runner.test('ModerationQueue: should initialize', () => {
    const ModerationQueue = require('../src/services/ModerationQueue');
    const queue = new ModerationQueue(mockBot);
    runner.assertTrue(queue, 'Queue should exist');
});

runner.test('ModerationQueue: generateActionKey should be consistent', () => {
    const ModerationQueue = require('../src/services/ModerationQueue');
    const queue = new ModerationQueue(mockBot);
    
    const key1 = queue.generateActionKey('guild1', 'user1', 'ban', 'reason');
    const key2 = queue.generateActionKey('guild1', 'user1', 'ban', 'reason');
    runner.assertEqual(key1, key2, 'Same inputs should produce same key');
    
    const key3 = queue.generateActionKey('guild2', 'user1', 'ban', 'reason');
    runner.assertTrue(key1 !== key3, 'Different guild should produce different key');
});

runner.test('ModerationQueue: enqueue should reject missing required fields', async () => {
    const ModerationQueue = require('../src/services/ModerationQueue');
    const queue = new ModerationQueue(mockBot);
    
    let threw = false;
    try {
        await queue.enqueue({
            guildId: mockGuild.id,
            // missing targetId and actionType
        });
    } catch (err) {
        threw = true;
        runner.assertTrue(err.message.includes('Missing required fields'), 'Should mention missing fields');
    }
    runner.assertTrue(threw, 'Should throw for missing fields');
});

runner.test('ModerationQueue: enqueue should add valid action to queue', async () => {
    const ModerationQueue = require('../src/services/ModerationQueue');
    const queue = new ModerationQueue(mockBot);
    
    const result = await queue.enqueue({
        guildId: mockGuild.id,
        targetId: mockUser.id,
        moderatorId: '111111111111111111',
        actionType: 'warn',
        reason: 'Test warning',
        skipEscalation: true
    });
    
    runner.assertTrue(result.queued, 'Should enqueue successfully');
    runner.assertTrue(result.actionKey, 'Should return action key');
});

runner.test('ModerationQueue: isDuplicate should detect duplicates', async () => {
    const ModerationQueue = require('../src/services/ModerationQueue');
    const queue = new ModerationQueue(mockBot);
    
    const actionKey = queue.generateActionKey('guild1', 'user1', 'warn', 'test');
    
    runner.assertFalse(queue.isDuplicate(actionKey), 'Should not be duplicate initially');
    
    // Simulate execution
    queue.actionHistory.set(actionKey, Date.now());
    
    runner.assertTrue(queue.isDuplicate(actionKey), 'Should detect duplicate after execution');
});

// ─────────────────────────────────────────────────────────────
// ConfigService Tests
// ─────────────────────────────────────────────────────────────

runner.test('ConfigService: should instantiate', () => {
    const ConfigService = require('../src/services/ConfigService');
    const config = new ConfigService(mockBot);
    runner.assertTrue(config, 'Config service should exist');
});

runner.test('ConfigService: validateValue should validate types', () => {
    const ConfigService = require('../src/services/ConfigService');
    const config = new ConfigService(mockBot);
    
    // Boolean
    let result = config.validateValue('anti_spam_enabled', true);
    runner.assertTrue(result.valid, 'Boolean true should be valid');
    runner.assertEqual(result.value, true, 'Value should be true');
    
    result = config.validateValue('anti_spam_enabled', 'invalid');
    runner.assertFalse(result.valid, 'String should not be valid for boolean');
    
    // Snowflake
    result = config.validateValue('verified_role_id', '123456789012345678');
    runner.assertTrue(result.valid, 'Valid snowflake should pass');
    
    result = config.validateValue('verified_role_id', 'abc');
    runner.assertFalse(result.valid, 'Invalid snowflake should fail');
});

runner.test('ConfigService: schema validation should enforce rules', () => {
    const ConfigService = require('../src/services/ConfigService');
    const config = new ConfigService(mockBot);
    
    const valid = config.validateConfig({
        verification_enabled: true,
        verification_method: 'button'
    });
    runner.assertTrue(valid.valid, 'Valid config should pass');
    
    const invalid = config.validateConfig({
        verification_enabled: 'yes' // Should be boolean
    });
    runner.assertFalse(invalid.valid, 'Invalid type should fail');
});

runner.test('ConfigService: generateVersion should be deterministic', () => {
    const ConfigService = require('../src/services/ConfigService');
    const config = new ConfigService(mockBot);
    
    const obj = { a: 1, b: 2 };
    const hash1 = config.generateVersion(obj);
    const hash2 = config.generateVersion(obj);
    runner.assertEqual(hash1, hash2, 'Same object should produce same hash');
});

// ─────────────────────────────────────────────────────────────
// VerificationService Tests
// ─────────────────────────────────────────────────────────────

runner.test('VerificationService: should instantiate', () => {
    const VerificationService = require('../src/services/VerificationService');
    const verification = new VerificationService(mockBot);
    runner.assertTrue(verification, 'Verification service should exist');
});

runner.test('VerificationService: generateCode should create valid code', () => {
    const VerificationService = require('../src/services/VerificationService');
    const verification = new VerificationService(mockBot);
    
    const code = verification.generateCode();
    runner.assertTrue(code.length === 6, 'Code should be 6 chars');
    runner.assertTrue(/^[A-Z0-9]+$/.test(code), 'Code should be alphanumeric uppercase');
});

runner.test('VerificationService: isRateLimited should allow first attempt', () => {
    const VerificationService = require('../src/services/VerificationService');
    const verification = new VerificationService(mockBot);
    
    const limited = verification.isRateLimited('testuser1');
    runner.assertFalse(limited, 'First attempt should not be rate limited');
});

runner.test('VerificationService: recordAttempt should trigger rate limit', () => {
    const VerificationService = require('../src/services/VerificationService');
    const verification = new VerificationService(mockBot);
    
    verification.recordAttempt('testuser2');
    const limited = verification.isRateLimited('testuser2');
    runner.assertTrue(limited, 'Should be rate limited after attempt');
});

runner.test('VerificationService: calculateRiskScore should return valid score', () => {
    const VerificationService = require('../src/services/VerificationService');
    const verification = new VerificationService(mockBot);
    
    const score = verification.calculateRiskScore(mockMember);
    runner.assertTrue(typeof score === 'number', 'Score should be a number');
    runner.assertTrue(score >= 0 && score <= 100, 'Score should be 0-100');
});

runner.test('VerificationService: calculateRiskScore should flag new accounts', () => {
    const VerificationService = require('../src/services/VerificationService');
    const verification = new VerificationService(mockBot);
    
    const newAccountMember = {
        ...mockMember,
        user: {
            ...mockUser,
            createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day old
            createdTimestamp: Date.now() - 1 * 24 * 60 * 60 * 1000
        }
    };
    
    const oldScore = verification.calculateRiskScore(mockMember);
    const newScore = verification.calculateRiskScore(newAccountMember);
    
    runner.assertTrue(newScore > oldScore, 'New accounts should have higher risk');
});

runner.test('VerificationService: hashCode should be consistent', () => {
    const VerificationService = require('../src/services/VerificationService');
    const verification = new VerificationService(mockBot);
    
    const hash1 = verification.hashCode('ABC123');
    const hash2 = verification.hashCode('ABC123');
    runner.assertEqual(hash1, hash2, 'Same code should produce same hash');
    
    const hash3 = verification.hashCode('abc123');
    runner.assertEqual(hash1, hash3, 'Hash should be case insensitive');
});

// Run all tests
runner.run().then(success => {
    process.exit(success ? 0 : 1);
}).catch(err => {
    console.error('Test runner failed:', err);
    process.exit(1);
});
