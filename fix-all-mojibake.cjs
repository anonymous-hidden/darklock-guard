// fix-all-mojibake.cjs
// CommonJS script to fix mojibake in all HTML files
// Run with: npm run fix-encoding
const fs = require('fs');
const path = require('path');

// Support running from project root or any directory
const viewsDir = path.join(__dirname, 'src/dashboard/views');

// Comprehensive mojibake patterns mapped to correct emojis
// These are UTF-8 bytes incorrectly decoded as Latin-1
const replacements = {
    // Shield
    '\u00c3\u00b0\u00c5\u00b8\u00e2\u0080\u00ba\u00c2\u00a1\u00c3\u00af\u00c2\u00b8\u00c2\u008f': '\u{1F6E1}\u{FE0F}',
    '\u00f0\u009f\u009b\u00a1\u00ef\u00b8\u008f': '\u{1F6E1}\u{FE0F}',
    'ðŸ›¡ï¸': '🛡️',
    
    // People
    '\u00f0\u009f\u0091\u00a5': '\u{1F465}',
    'ðŸ'¥': '👥',
    
    // Monitor
    '\u00f0\u009f\u0096\u00a5\u00ef\u00b8\u008f': '\u{1F5A5}\u{FE0F}',
    'ðŸ–¥ï¸': '🖥️',
    
    // Warning
    '\u00e2\u009a\u00a0\u00ef\u00b8\u008f': '\u{26A0}\u{FE0F}',
    'âš ï¸': '⚠️',
    
    // Magnifying glass
    '\u00f0\u009f\u0094\u008d': '\u{1F50D}',
    'ðŸ"': '🔍',
    
    // Chart
    '\u00f0\u009f\u0093\u008a': '\u{1F4CA}',
    'ðŸ"Š': '📊',
    
    // Wrench
    '\u00f0\u009f\u0094\u00a7': '\u{1F527}',
    'ðŸ"§': '🔧',
    
    // Unlock
    '\u00f0\u009f\u0094\u0093': '\u{1F513}',
    'ðŸ""': '🔓',
    
    // Key
    '\u00f0\u009f\u0094\u0091': '\u{1F511}',
    'ðŸ"'': '🔑',
    
    // Game controller
    '\u00f0\u009f\u008e\u00ae': '\u{1F3AE}',
    'ðŸŽ®': '🎮',
    
    // Rocket
    '\u00f0\u009f\u009a\u0080': '\u{1F680}',
    'ðŸš€': '🚀',
    
    // Memo
    '\u00f0\u009f\u0093\u009d': '\u{1F4DD}',
    'ðŸ"': '📝',
    
    // Speech bubble
    '\u00f0\u009f\u0092\u00ac': '\u{1F4AC}',
    'ðŸ'¬': '💬',
    
    // Wave
    '\u00f0\u009f\u0091\u008b': '\u{1F44B}',
    'ðŸ'‹': '👋',
    
    // Mailbox with mail
    '\u00f0\u009f\u0093\u00ac': '\u{1F4EC}',
    'ðŸ"¬': '📬',
    
    // Envelope with arrow
    '\u00f0\u009f\u0093\u00a9': '\u{1F4E9}',
    'ðŸ"©': '📩',
    
    // Robot
    '\u00f0\u009f\u00a4\u0096': '\u{1F916}',
    'ðŸ¤–': '🤖',
    
    // Crystal ball
    '\u00f0\u009f\u0094\u00ae': '\u{1F52E}',
    'ðŸ"®': '🔮',
    
    // Sparkles
    '\u00e2\u009c\u00a8': '\u{2728}',
    'âœ¨': '✨',
    
    // Party popper
    '\u00f0\u009f\u008e\u0089': '\u{1F389}',
    'ðŸŽ‰': '🎉',
    
    // Gear
    '\u00e2\u009a\u0099\u00ef\u00b8\u008f': '\u{2699}\u{FE0F}',
    'âš™ï¸': '⚙️',
    
    // Pin
    '\u00f0\u009f\u0093\u008d': '\u{1F4CD}',
    'ðŸ'': '📍',
    
    // Eyes
    '\u00f0\u009f\u0091\u0080': '\u{1F440}',
    'ðŸ'€': '👀',
    
    // Clipboard
    '\u00f0\u009f\u0093\u008b': '\u{1F4CB}',
    'ðŸ"': '📋',
    'ðŸ"‹': '📋',
    
    // Pushpin
    '\u00f0\u009f\u0093\u008c': '\u{1F4CC}',
    'ðŸ"Œ': '📌',
    
    // Clock
    '\u00e2\u008f\u00b0': '\u{23F0}',
    'â°': '⏰',
    
    // Link
    '\u00f0\u009f\u0094\u0097': '\u{1F517}',
    'ðŸ"—': '🔗',
    
    // Checkmark
    '\u00e2\u009c\u0085': '\u{2705}',
    'âœ…': '✅',
    
    // X mark
    '\u00e2\u009d\u008c': '\u{274C}',
    'âŒ': '❌',
    
    // Satellite
    '\u00f0\u009f\u0093\u00a1': '\u{1F4E1}',
    'ðŸ"¡': '📡',
    
    // Thumbs down
    '\u00f0\u009f\u0091\u008e': '\u{1F44E}',
    'ðŸ'Ž': '👎',
    
    // Thumbs up
    '\u00f0\u009f\u0091\u008d': '\u{1F44D}',
    'ðŸ'': '👍',
    
    // Fire
    '\u00f0\u009f\u0094\u00a5': '\u{1F525}',
    'ðŸ"¥': '🔥',
    
    // Folder
    '\u00f0\u009f\u0093\u0082': '\u{1F4C2}',
    'ðŸ"': '📂',
    
    // Phone
    '\u00f0\u009f\u0093\u00b1': '\u{1F4F1}',
    'ðŸ"±': '📱',
    
    // Chart increasing
    '\u00f0\u009f\u0093\u0088': '\u{1F4C8}',
    'ðŸ"ˆ': '📈',
    
    // Info
    '\u00e2\u0084\u00b9\u00ef\u00b8\u008f': '\u{2139}\u{FE0F}',
    'â„¹ï¸': 'ℹ️',
    
    // Up arrow
    '\u00e2\u00ac\u0086\u00ef\u00b8\u008f': '\u{2B06}\u{FE0F}',
    'â¬†ï¸': '⬆️',
    
    // Down arrow
    '\u00e2\u00ac\u0087\u00ef\u00b8\u008f': '\u{2B07}\u{FE0F}',
    'â¬‡ï¸': '⬇️',
    
    // Play button
    '\u00e2\u0096\u00b6\u00ef\u00b8\u008f': '\u{25B6}\u{FE0F}',
    'â–¶ï¸': '▶️',
    
    // ID button
    '\u00f0\u009f\u0086\u0094': '\u{1F194}',
    'ðŸ†': '🆔',
    
    // Newspaper
    '\u00f0\u009f\u0093\u00b0': '\u{1F4F0}',
    'ðŸ"°': '📰',
    
    // Numbers
    '\u00f0\u009f\u0094\u00a2': '\u{1F522}',
    'ðŸ"¢': '🔢',
    
    // Lightbulb
    '\u00f0\u009f\u0092\u00a1': '\u{1F4A1}',
    'ðŸ'¡': '💡',
    
    // Heart with ribbon
    '\u00f0\u009f\u0092\u0093': '\u{1F493}',
    'ðŸ''': '💓',
    
    // Heart exclamation
    '\u00e2\u009d\u00a3\u00ef\u00b8\u008f': '\u{2763}\u{FE0F}',
    'â£ï¸': '❣️',
    
    // Computer
    '\u00f0\u009f\u0092\u00bb': '\u{1F4BB}',
    'ðŸ'»': '💻',
    
    // Lock
    '\u00f0\u009f\u0094\u0092': '\u{1F512}',
    'ðŸ"'': '🔒',
    
    // Closed mailbox
    '\u00f0\u009f\u0093\u00aa': '\u{1F4EA}',
    'ðŸ"ª': '📪',
    
    // Books
    '\u00f0\u009f\u0093\u0095': '\u{1F4D5}',
    'ðŸ"•': '📕',
    '\u00f0\u009f\u0093\u0096': '\u{1F4D6}',
    'ðŸ"–': '📖',
    '\u00f0\u009f\u0093\u0099': '\u{1F4D9}',
    'ðŸ"™': '📙',
    '\u00f0\u009f\u0093\u0097': '\u{1F4D7}',
    '\u00f0\u009f\u0093\u0098': '\u{1F4D8}',
    'ðŸ"˜': '📘',
    
    // Christmas
    '\u00f0\u009f\u008e\u0084': '\u{1F384}',
    'ðŸŽ„': '🎄',
    '\u00e2\u009d\u0084\u00ef\u00b8\u008f': '\u{2744}\u{FE0F}',
    'â„ï¸': '❄️',
    '\u00f0\u009f\u008e\u0085': '\u{1F385}',
    'ðŸŽ…': '🎅',
    '\u00e2\u009b\u0084': '\u{26C4}',
    'â›„': '⛄',
    '\u00f0\u009f\u008e\u0081': '\u{1F381}',
    'ðŸŽ': '🎁',
    
    // Notebook
    '\u00f0\u009f\u0093\u0094': '\u{1F4D4}',
    'ðŸ""': '📔',
    
    // Music
    '\u00f0\u009f\u008e\u00b6': '\u{1F3B6}',
    'ðŸŽ¶': '🎶',
    '\u00f0\u009f\u008e\u00b5': '\u{1F3B5}',
    'ðŸŽµ': '🎵',
    
    // Lightning
    '\u00e2\u009a\u00a1': '\u{26A1}',
    'âš¡': '⚡',
    
    // Small blue diamond
    '\u00f0\u009f\u0094\u00b9': '\u{1F539}',
    'ðŸ"¹': '🔹',
    
    // Bell
    '\u00f0\u009f\u0094\u0094': '\u{1F514}',
    'ðŸ""': '🔔',
    
    // Circles
    '\u00f0\u009f\u0094\u00b4': '\u{1F534}',
    'ðŸ"´': '🔴',
    '\u00f0\u009f\u009f\u00a2': '\u{1F7E2}',
    'ðŸŸ¢': '🟢',
    '\u00f0\u009f\u009f\u00a1': '\u{1F7E1}',
    'ðŸŸ¡': '🟡',
    '\u00f0\u009f\u009f\u00a0': '\u{1F7E0}',
    'ðŸŸ ': '🟠',
    '\u00f0\u009f\u009f\u00a3': '\u{1F7E3}',
    'ðŸŸ£': '🟣',
    '\u00f0\u009f\u0094\u00b5': '\u{1F535}',
    'ðŸ"µ': '🔵',
    
    // Brain
    '\u00f0\u009f\u00a7\u00a0': '\u{1F9E0}',
    'ðŸ§ ': '🧠',
    
    // Buttons
    '\u00f0\u009f\u0086\u0095': '\u{1F195}',
    'ðŸ†•': '🆕',
    '\u00f0\u009f\u0086\u0098': '\u{1F198}',
    'ðŸ†˜': '🆘',
    
    // Diamond
    '\u00f0\u009f\u0092\u008e': '\u{1F48E}',
    'ðŸ'Ž': '💎',
    
    // Telescope
    '\u00f0\u009f\u0094\u00ad': '\u{1F52D}',
    'ðŸ"­': '🔭',
    
    // Crying face
    '\u00f0\u009f\u0098\u00a2': '\u{1F622}',
    'ðŸ˜¢': '😢',
    
    // Person silhouette
    '\u00f0\u009f\u0091\u00a4': '\u{1F464}',
    'ðŸ'¤': '👤',
    
    // Direct hit
    '\u00f0\u009f\u008e\u00af': '\u{1F3AF}',
    'ðŸŽ¯': '🎯',
    
    // Refresh/Arrows
    '\u00f0\u009f\u0094\u0084': '\u{1F504}',
    'ðŸ"„': '🔄',
    
    // Ticket
    '\u00f0\u009f\u008e\u00ab': '\u{1F3AB}',
    'ðŸŽ«': '🎫',
    
    // Scroll
    '\u00f0\u009f\u0093\u009c': '\u{1F4DC}',
    'ðŸ"œ': '📜',
    
    // Siren
    '\u00f0\u009f\u009a\u00a8': '\u{1F6A8}',
    'ðŸš¨': '🚨',
    
    // No entry
    '\u00f0\u009f\u009a\u00ab': '\u{1F6AB}',
    'ðŸš«': '🚫',
    
    // Raising hand
    '\u00f0\u009f\u0099\u008b': '\u{1F64B}',
    'ðŸ™‹': '🙋',
    
    // Books
    '\u00f0\u009f\u0093\u009a': '\u{1F4DA}',
    'ðŸ"š': '📚',
};

// Check if directory exists
if (!fs.existsSync(viewsDir)) {
    console.error('Views directory not found:', viewsDir);
    process.exit(1);
}

// Get all HTML files
const files = fs.readdirSync(viewsDir).filter(f => f.endsWith('.html'));

console.log(\`Found \${files.length} HTML files in \${viewsDir}\`);

let totalFixed = 0;
let totalReplacements = 0;

for (const file of files) {
    const filePath = path.join(viewsDir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    const original = content;
    let fileReplacements = 0;
    
    // Apply all replacements
    for (const [pattern, replacement] of Object.entries(replacements)) {
        if (content.includes(pattern)) {
            const count = content.split(pattern).length - 1;
            content = content.split(pattern).join(replacement);
            fileReplacements += count;
        }
    }
    
    if (content !== original) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(\`✓ Fixed: \${file} (\${fileReplacements} replacements)\`);
        totalFixed++;
        totalReplacements += fileReplacements;
    }
}

console.log(\`\\n=== Summary ===\`);
console.log(\`Files processed: \${files.length}\`);
console.log(\`Files fixed: \${totalFixed}\`);
console.log(\`Total replacements: \${totalReplacements}\`);
console.log(\`\\nDone!\`);
