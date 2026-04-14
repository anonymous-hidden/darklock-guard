// tests for the enterprise stuff
// SecurityMiddleware, ModerationQueue, ConfigService, VerificationService

const mockUser = {
    id: '123456789012345678',
    tag: 'TestUser#0001',
    username: 'TestUser',
    displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
    createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
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
    permissions: { has: () => false }
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
    channels: { cache: new Map() }
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

const mockBot = {
    database: mockDatabase,
    logger: {
        info: console.log,
        warn: console.warn,
        error: console.error,
        debug: () => {}
    },
    client: {
        guilds: { cache: new Map([[mockGuild.id, mockGuild]]) }
    },
    dashboard: { broadcastToGuild: () => {} },
    forensicsManager: { logAuditEvent: async () => true },
    permissionManager: { isAllowed: async () => true }
};

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
        console.log('\nrunning tests...\n');

        for (const test of this.tests) {
            try {
                await test.fn();
                console.log(`pass: ${test.name}`);
                this.passed++;
            } catch (err) {
                console.log(`FAIL: ${test.name}`);
                console.log(`  ${err.message}`);
                this.failed++;
            }
        }

        console.log(`\n${this.passed} passed, ${this.failed} failed\n`);
        return this.failed === 0;
    }

    assertEqual(a, b, msg = '') {
        if (a !== b) throw new Error(`${msg}: expected ${b}, got ${a}`);
    }

    assertTrue(v, msg = '') {
        if (!v) throw new Error(`${msg}: expected truthy, got ${v}`);
    }

    assertFalse(v, msg = '') {
        if (v) throw new Error(`${msg}: expected falsy, got ${v}`);
    }
}

const runner = new TestRunner();

// securitymiddleware

runner.test('SecurityMiddleware: init', () => {
    const SecurityMiddleware = require('../src/services/SecurityMiddleware');
    const m = new SecurityMiddleware(mockBot);
    runner.assertTrue(m, 'should exist');
});

runner.test('SecurityMiddleware: checkBlocked passes for clean user', async () => {
    const SecurityMiddleware = require('../src/services/SecurityMiddleware');
    const m = new SecurityMiddleware(mockBot);
    const r = m.checkBlocked(mockInteraction);
    runner.assertTrue(r.passed, 'unblocked user should pass');
});

runner.test('SecurityMiddleware: blockUser works', async () => {
    const SecurityMiddleware = require('../src/services/SecurityMiddleware');
    const m = new SecurityMiddleware(mockBot);
    m.blockUser('testuser123');
    const r = m.checkBlocked({ user: { id: 'testuser123' } });
    runner.assertFalse(r.passed, 'blocked user should fail');
    runner.assertEqual(r.code, 'BLOCKED', 'code should be BLOCKED');
});

runner.test('SecurityMiddleware: rate limit passes first time', () => {
    const SecurityMiddleware = require('../src/services/SecurityMiddleware');
    const m = new SecurityMiddleware(mockBot);
    const r = m.checkRateLimit(mockInteraction);
    runner.assertTrue(r.passed, 'first call should pass');
});

runner.test('SecurityMiddleware: snowflake validation', () => {
    const SecurityMiddleware = require('../src/services/SecurityMiddleware');
    const m = new SecurityMiddleware(mockBot);
    runner.assertTrue(m.isValidSnowflake('123456789012345678'), '18 digit');
    runner.assertTrue(m.isValidSnowflake('12345678901234567890'), '20 digit');
    runner.assertFalse(m.isValidSnowflake('123'), 'too short');
    runner.assertFalse(m.isValidSnowflake('abc'), 'not numeric');
});

runner.test('SecurityMiddleware: sanitize removes @everyone @here', () => {
    const SecurityMiddleware = require('../src/services/SecurityMiddleware');
    const m = new SecurityMiddleware(mockBot);
    const s = m.sanitize('test @everyone @here test');
    runner.assertFalse(s.includes('@everyone'), 'everyone gone');
    runner.assertFalse(s.includes('@here'), 'here gone');
});

runner.test('SecurityMiddleware: blocks suspicious input', () => {
    const SecurityMiddleware = require('../src/services/SecurityMiddleware');
    const m = new SecurityMiddleware(mockBot);
    const bad = {
        user: mockUser,
        options: { data: [{ value: 'Get free nitro at discord.gift/xyz' }] }
    };
    const r = m.checkInputValidation(bad);
    runner.assertFalse(r.passed, 'should block it');
});

// moderationqueue

runner.test('ModerationQueue: init', () => {
    const ModerationQueue = require('../src/services/ModerationQueue');
    const q = new ModerationQueue(mockBot);
    runner.assertTrue(q, 'should exist');
});

runner.test('ModerationQueue: generateActionKey is deterministic', () => {
    const ModerationQueue = require('../src/services/ModerationQueue');
    const q = new ModerationQueue(mockBot);
    const k1 = q.generateActionKey('guild1', 'user1', 'ban', 'reason');
    const k2 = q.generateActionKey('guild1', 'user1', 'ban', 'reason');
    runner.assertEqual(k1, k2, 'same inputs same key');
    const k3 = q.generateActionKey('guild2', 'user1', 'ban', 'reason');
    runner.assertTrue(k1 !== k3, 'diff guild diff key');
});

runner.test('ModerationQueue: rejects missing fields', async () => {
    const ModerationQueue = require('../src/services/ModerationQueue');
    const q = new ModerationQueue(mockBot);
    let threw = false;
    try {
        await q.enqueue({ guildId: mockGuild.id });
    } catch (err) {
        threw = true;
        runner.assertTrue(err.message.includes('Missing required fields'), 'mention missing fields');
    }
    runner.assertTrue(threw, 'should throw');
});

runner.test('ModerationQueue: enqueue valid action', async () => {
    const ModerationQueue = require('../src/services/ModerationQueue');
    const q = new ModerationQueue(mockBot);
    const r = await q.enqueue({
        guildId: mockGuild.id,
        targetId: mockUser.id,
        moderatorId: '111111111111111111',
        actionType: 'warn',
        reason: 'test',
        skipEscalation: true
    });
    runner.assertTrue(r.queued, 'should queue');
    runner.assertTrue(r.actionKey, 'should have key');
});

runner.test('ModerationQueue: isDuplicate catches dupes', async () => {
    const ModerationQueue = require('../src/services/ModerationQueue');
    const q = new ModerationQueue(mockBot);
    const key = q.generateActionKey('guild1', 'user1', 'warn', 'test');
    runner.assertFalse(q.isDuplicate(key), 'not dupe at start');
    q.actionHistory.set(key, Date.now());
    runner.assertTrue(q.isDuplicate(key), 'dupe after adding');
});

// configservice

runner.test('ConfigService: init', () => {
    const ConfigService = require('../src/services/ConfigService');
    const c = new ConfigService(mockBot);
    runner.assertTrue(c, 'should exist');
});

runner.test('ConfigService: validateValue types', () => {
    const ConfigService = require('../src/services/ConfigService');
    const c = new ConfigService(mockBot);

    let r = c.validateValue('anti_spam_enabled', true);
    runner.assertTrue(r.valid, 'bool true valid');
    runner.assertEqual(r.value, true, 'value true');

    r = c.validateValue('anti_spam_enabled', 'invalid');
    runner.assertFalse(r.valid, 'string not valid for bool');

    r = c.validateValue('verified_role_id', '123456789012345678');
    runner.assertTrue(r.valid, 'valid snowflake');

    r = c.validateValue('verified_role_id', 'abc');
    runner.assertFalse(r.valid, 'bad snowflake');
});

runner.test('ConfigService: schema enforcement', () => {
    const ConfigService = require('../src/services/ConfigService');
    const c = new ConfigService(mockBot);
    const good = c.validateConfig({ verification_enabled: true, verification_method: 'button' });
    runner.assertTrue(good.valid, 'valid config passes');
    const bad = c.validateConfig({ verification_enabled: 'yes' });
    runner.assertFalse(bad.valid, 'wrong type fails');
});

runner.test('ConfigService: generateVersion deterministic', () => {
    const ConfigService = require('../src/services/ConfigService');
    const c = new ConfigService(mockBot);
    const obj = { a: 1, b: 2 };
    runner.assertEqual(c.generateVersion(obj), c.generateVersion(obj), 'same hash');
});

// verificationservice

runner.test('VerificationService: init', () => {
    const VerificationService = require('../src/services/VerificationService');
    const v = new VerificationService(mockBot);
    runner.assertTrue(v, 'should exist');
});

runner.test('VerificationService: generateCode format', () => {
    const VerificationService = require('../src/services/VerificationService');
    const v = new VerificationService(mockBot);
    const code = v.generateCode();
    runner.assertTrue(code.length === 6, '6 chars');
    runner.assertTrue(/^[A-Z0-9]+$/.test(code), 'uppercase alphanumeric');
});

runner.test('VerificationService: first attempt not rate limited', () => {
    const VerificationService = require('../src/services/VerificationService');
    const v = new VerificationService(mockBot);
    runner.assertFalse(v.isRateLimited('testuser1'), 'should be fine first time');
});

runner.test('VerificationService: rate limited after attempt', () => {
    const VerificationService = require('../src/services/VerificationService');
    const v = new VerificationService(mockBot);
    v.recordAttempt('testuser2');
    runner.assertTrue(v.isRateLimited('testuser2'), 'should be limited');
});

runner.test('VerificationService: risk score range', () => {
    const VerificationService = require('../src/services/VerificationService');
    const v = new VerificationService(mockBot);
    const score = v.calculateRiskScore(mockMember);
    runner.assertTrue(typeof score === 'number', 'is number');
    runner.assertTrue(score >= 0 && score <= 100, '0-100 range');
});

runner.test('VerificationService: new accounts score higher', () => {
    const VerificationService = require('../src/services/VerificationService');
    const v = new VerificationService(mockBot);
    const newMember = {
        ...mockMember,
        user: {
            ...mockUser,
            createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
            createdTimestamp: Date.now() - 1 * 24 * 60 * 60 * 1000
        }
    };
    runner.assertTrue(v.calculateRiskScore(newMember) > v.calculateRiskScore(mockMember), 'new acct higher risk');
});

runner.test('VerificationService: hashCode case insensitive', () => {
    const VerificationService = require('../src/services/VerificationService');
    const v = new VerificationService(mockBot);
    runner.assertEqual(v.hashCode('ABC123'), v.hashCode('ABC123'), 'consistent');
    runner.assertEqual(v.hashCode('ABC123'), v.hashCode('abc123'), 'case insensitive');
});

runner.run().then(ok => process.exit(ok ? 0 : 1)).catch(err => {
    console.error('runner crashed:', err);
    process.exit(1);
});
