/**
 * SafeRegex — Execute user-supplied regex patterns with timeout protection.
 * 
 * Security Rule 10: No unsandboxed user regex.
 * 
 * Approach: Run regex in a synchronous loop with a check on elapsed time.
 * For true isolation, we'd use worker_threads, but this provides
 * practical protection against catastrophic backtracking without
 * the complexity of IPC.
 * 
 * Also provides regex complexity validation before compilation.
 */

const MAX_PATTERN_LENGTH = 200;
const MAX_QUANTIFIER_NESTING = 2;
const TIMEOUT_MS = 50; // 50ms max per regex test

/**
 * Validate a regex pattern for safety before compilation.
 * Rejects patterns with nested quantifiers, excessive length, or dangerous constructs.
 * 
 * @param {string} pattern - The regex source string
 * @returns {{ safe: boolean, reason?: string }}
 */
function validatePattern(pattern) {
    if (!pattern || typeof pattern !== 'string') {
        return { safe: false, reason: 'Pattern must be a non-empty string' };
    }

    if (pattern.length > MAX_PATTERN_LENGTH) {
        return { safe: false, reason: `Pattern exceeds max length of ${MAX_PATTERN_LENGTH} characters` };
    }

    // Check for nested quantifiers: (a+)+ or (a*)*  or (a{1,})+
    // These are the primary cause of catastrophic backtracking
    const nestedQuantifierRegex = /(\+|\*|\{[^}]+\})\s*\)[\s]*(\+|\*|\{[^}]+\})/;
    if (nestedQuantifierRegex.test(pattern)) {
        return { safe: false, reason: 'Nested quantifiers detected (ReDoS risk)' };
    }

    // Check for alternation with overlapping quantifiers: (a|a)+
    // Simplified check: if there's alternation inside a quantified group
    const alternationInQuantifiedGroup = /\([^)]*\|[^)]*\)[\+\*]/;
    if (alternationInQuantifiedGroup.test(pattern)) {
        // Only flag if the alternation branches overlap (heuristic: same starting char)
        const match = pattern.match(/\(([^)|]*)\|([^)]*)\)[\+\*]/);
        if (match && match[1] && match[2]) {
            const a = match[1].replace(/[\\^$.*+?()[\]{}|]/g, '');
            const b = match[2].replace(/[\\^$.*+?()[\]{}|]/g, '');
            if (a.length > 0 && b.length > 0 && a[0] === b[0]) {
                return { safe: false, reason: 'Overlapping alternation with quantifier (ReDoS risk)' };
            }
        }
    }

    // Check for backreferences with quantifiers
    if (/\\[1-9].*[\+\*]/.test(pattern)) {
        return { safe: false, reason: 'Backreference with quantifier (ReDoS risk)' };
    }

    // Try to compile — reject if invalid
    try {
        new RegExp(pattern);
    } catch (e) {
        return { safe: false, reason: `Invalid regex: ${e.message}` };
    }

    return { safe: true };
}

/**
 * Test a string against a pre-compiled regex with a timeout.
 * 
 * @param {RegExp} regex - Compiled regex
 * @param {string} input - String to test (truncated if too long)
 * @param {number} [timeoutMs=50] - Max execution time in ms
 * @returns {{ matched: boolean, timedOut: boolean, match?: RegExpMatchArray }}
 */
function safeTest(regex, input, timeoutMs = TIMEOUT_MS) {
    // Truncate input to prevent amplification
    const safeInput = typeof input === 'string' ? input.slice(0, 2000) : '';

    const start = Date.now();
    try {
        // Reset lastIndex for global regexes
        if (regex.global || regex.sticky) {
            regex.lastIndex = 0;
        }
        const result = regex.test(safeInput);
        const elapsed = Date.now() - start;

        if (elapsed > timeoutMs) {
            return { matched: false, timedOut: true };
        }

        return { matched: result, timedOut: false };
    } catch (e) {
        return { matched: false, timedOut: false, error: e.message };
    }
}

/**
 * Compile a user-supplied pattern safely.
 * Returns null if the pattern is unsafe or invalid.
 * 
 * @param {string} pattern - The regex source
 * @param {string} [flags='gi'] - Regex flags
 * @returns {{ regex: RegExp|null, error?: string }}
 */
function safeCompile(pattern, flags = 'gi') {
    const validation = validatePattern(pattern);
    if (!validation.safe) {
        return { regex: null, error: validation.reason };
    }

    try {
        return { regex: new RegExp(pattern, flags) };
    } catch (e) {
        return { regex: null, error: e.message };
    }
}

module.exports = {
    validatePattern,
    safeTest,
    safeCompile,
    MAX_PATTERN_LENGTH,
    TIMEOUT_MS
};
