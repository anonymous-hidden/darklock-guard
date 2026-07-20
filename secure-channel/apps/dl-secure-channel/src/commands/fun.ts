/**
 * Fun / Game Commands — /coinflip, /roll, /8ball, /rps, /trivia, /xp, /leaderboard, etc.
 *
 * Game randomness: Uses crypto.getRandomValues() for all random operations
 * to ensure fair and unpredictable results.
 *
 * XP system:
 * - Users gain 15-25 XP per message (with 60s cooldown to prevent spam)
 * - Level formula: level = floor(sqrt(xp / 100))
 * - XP needed for next level: (level + 1)^2 * 100
 * - Role rewards can be configured per-server
 */

import { registerCommand, type CommandHandler } from "@/lib/commandRegistry";
import type { SlashCommand } from "@/types";

// ── Secure randomness helper ────────────────────────────────────────────────

function secureRandom(max: number): number {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0] % max;
}

// ── /coinflip ───────────────────────────────────────────────────────────────

const coinflipCommand: SlashCommand = {
  name: "coinflip",
  description: "Flip a coin",
  category: "fun",
  params: [],
  cooldownMs: 3000,
};

const coinflipHandler: CommandHandler = async () => {
  const result = secureRandom(2) === 0 ? "🪙 **Heads!**" : "🪙 **Tails!**";
  return { success: true, message: result, ephemeral: false };
};

// ── /roll ───────────────────────────────────────────────────────────────────

const rollCommand: SlashCommand = {
  name: "roll",
  description: "Roll dice (e.g., 2d6, d20)",
  category: "fun",
  params: [
    { name: "dice", description: "Dice notation (e.g., 2d6, d20, 4d8)", type: "string", required: false },
  ],
  cooldownMs: 3000,
};

const rollHandler: CommandHandler = async (args) => {
  const notation = args.dice ?? "1d6";
  const match = notation.match(/^(\d*)d(\d+)$/i);
  if (!match) return { success: false, message: "Invalid dice notation. Use format: 2d6, d20, etc.", ephemeral: true };

  const count = parseInt(match[1] || "1", 10);
  const sides = parseInt(match[2], 10);

  if (count < 1 || count > 20) return { success: false, message: "Roll 1-20 dice at a time.", ephemeral: true };
  if (sides < 2 || sides > 100) return { success: false, message: "Dice must have 2-100 sides.", ephemeral: true };

  const rolls: number[] = [];
  for (let i = 0; i < count; i++) {
    rolls.push(secureRandom(sides) + 1);
  }

  const total = rolls.reduce((a, b) => a + b, 0);
  const rollsStr = rolls.join(", ");
  return {
    success: true,
    message: `🎲 **${notation}** → [${rollsStr}] = **${total}**`,
    ephemeral: false,
  };
};

// ── /8ball ──────────────────────────────────────────────────────────────────

const eightballCommand: SlashCommand = {
  name: "8ball",
  description: "Ask the magic 8-ball a question",
  category: "fun",
  params: [
    { name: "question", description: "Your question", type: "string", required: true },
  ],
  cooldownMs: 5000,
};

const EIGHT_BALL_RESPONSES = [
  "🎱 It is certain.",
  "🎱 It is decidedly so.",
  "🎱 Without a doubt.",
  "🎱 Yes, definitely.",
  "🎱 You may rely on it.",
  "🎱 As I see it, yes.",
  "🎱 Most likely.",
  "🎱 Outlook good.",
  "🎱 Yes.",
  "🎱 Signs point to yes.",
  "🎱 Reply hazy, try again.",
  "🎱 Ask again later.",
  "🎱 Better not tell you now.",
  "🎱 Cannot predict now.",
  "🎱 Concentrate and ask again.",
  "🎱 Don't count on it.",
  "🎱 My reply is no.",
  "🎱 My sources say no.",
  "🎱 Outlook not so good.",
  "🎱 Very doubtful.",
];

const eightballHandler: CommandHandler = async (args) => {
  const response = EIGHT_BALL_RESPONSES[secureRandom(EIGHT_BALL_RESPONSES.length)];
  return {
    success: true,
    message: `> ${args.question}\n${response}`,
    ephemeral: false,
  };
};

// ── /rps ────────────────────────────────────────────────────────────────────

const rpsCommand: SlashCommand = {
  name: "rps",
  description: "Play Rock, Paper, Scissors",
  category: "fun",
  params: [
    { name: "choice", description: "rock, paper, or scissors", type: "string", required: true, choices: [
      { name: "Rock 🪨", value: "rock" },
      { name: "Paper 📄", value: "paper" },
      { name: "Scissors ✂️", value: "scissors" },
    ]},
  ],
  cooldownMs: 3000,
};

const RPS_EMOJI: Record<string, string> = { rock: "🪨", paper: "📄", scissors: "✂️" };
const RPS_BEATS: Record<string, string> = { rock: "scissors", paper: "rock", scissors: "paper" };

const rpsHandler: CommandHandler = async (args) => {
  const choices = ["rock", "paper", "scissors"];
  const player = args.choice.toLowerCase();
  if (!choices.includes(player)) return { success: false, message: "Choose rock, paper, or scissors.", ephemeral: true };

  const bot = choices[secureRandom(3)];
  const playerEmoji = RPS_EMOJI[player];
  const botEmoji = RPS_EMOJI[bot];

  if (player === bot) {
    return { success: true, message: `${playerEmoji} vs ${botEmoji} — **It's a tie!**`, ephemeral: false };
  }
  if (RPS_BEATS[player] === bot) {
    return { success: true, message: `${playerEmoji} vs ${botEmoji} — **You win!** 🎉`, ephemeral: false };
  }
  return { success: true, message: `${playerEmoji} vs ${botEmoji} — **You lose!** 😔`, ephemeral: false };
};

// ── /guess ──────────────────────────────────────────────────────────────────

const guessCommand: SlashCommand = {
  name: "guess",
  description: "Guess a number between 1-100",
  category: "fun",
  params: [
    { name: "number", description: "Your guess (1-100)", type: "number", required: true },
  ],
  cooldownMs: 5000,
};

const guessHandler: CommandHandler = async (args) => {
  const guess = parseInt(args.number, 10);
  if (guess < 1 || guess > 100) return { success: false, message: "Guess a number between 1 and 100!", ephemeral: true };

  const target = secureRandom(100) + 1;
  const diff = Math.abs(guess - target);

  if (diff === 0) {
    return { success: true, message: `🎯 You guessed **${guess}** — the number was **${target}**! Perfect! 🎉`, ephemeral: false };
  } else if (diff <= 5) {
    return { success: true, message: `🔥 So close! You guessed **${guess}**, the number was **${target}**! (off by ${diff})`, ephemeral: false };
  } else if (diff <= 15) {
    return { success: true, message: `🤏 Almost! You guessed **${guess}**, the number was **${target}**. (off by ${diff})`, ephemeral: false };
  } else {
    return { success: true, message: `❌ You guessed **${guess}**, the number was **${target}**. (off by ${diff})`, ephemeral: false };
  }
};

// ── /math ───────────────────────────────────────────────────────────────────

const mathCommand: SlashCommand = {
  name: "math",
  description: "Solve a quick math challenge",
  category: "fun",
  params: [],
  cooldownMs: 10000,
};

const mathHandler: CommandHandler = async () => {
  const ops = ["+", "-", "×"];
  const op = ops[secureRandom(3)];
  const a = secureRandom(50) + 1;
  const b = secureRandom(50) + 1;

  let answer: number;
  switch (op) {
    case "+": answer = a + b; break;
    case "-": answer = a - b; break;
    case "×": answer = a * b; break;
    default: answer = a + b;
  }

  return {
    success: true,
    message: `🧮 **Math Challenge:** What is ${a} ${op} ${b}?\n||Answer: **${answer}**||`,
    ephemeral: false,
  };
};

// ── /trivia ─────────────────────────────────────────────────────────────────

const triviaCommand: SlashCommand = {
  name: "trivia",
  description: "Get a random trivia question",
  category: "fun",
  params: [],
  cooldownMs: 10000,
};

const TRIVIA = [
  { q: "What is the most common element in the universe?", a: "Hydrogen" },
  { q: "In what year was the first computer virus created?", a: "1986 (Brain)" },
  { q: "What does the 'S' in HTTPS stand for?", a: "Secure" },
  { q: "What encryption standard does AES stand for?", a: "Advanced Encryption Standard" },
  { q: "How many bits in a byte?", a: "8" },
  { q: "What protocol does Darklock use for key agreement?", a: "X3DH (Extended Triple Diffie-Hellman)" },
  { q: "What year was the RSA algorithm published?", a: "1977" },
  { q: "What is the default port for HTTPS?", a: "443" },
  { q: "What does E2E in E2E encryption stand for?", a: "End-to-End" },
  { q: "What language is the Linux kernel written in?", a: "C" },
  { q: "What does DNS stand for?", a: "Domain Name System" },
  { q: "What is the name of the protocol that provides forward secrecy in messaging?", a: "Double Ratchet" },
];

const triviaHandler: CommandHandler = async () => {
  const t = TRIVIA[secureRandom(TRIVIA.length)];
  return {
    success: true,
    message: `🧠 **Trivia:** ${t.q}\n||${t.a}||`,
    ephemeral: false,
  };
};

// ── /meme ───────────────────────────────────────────────────────────────────

const memeCommand: SlashCommand = {
  name: "meme",
  description: "Get a random security meme text",
  category: "fun",
  params: [],
  cooldownMs: 5000,
};

const MEMES = [
  "🔐 My password is ***** — oh wait, it's showing asterisks for me too!",
  "🤔 To encrypt or not to encrypt, that is never the question — always encrypt.",
  "😅 My code doesn't have bugs, it has security features.",
  "🔒 I don't always test my code, but when I do, I test in production... behind a VPN.",
  "🙃 JSON Web Tokens: Because why wouldn't you send your auth data in a cookie named 'jwt' that's not httpOnly?",
  "💀 `chmod 777` — the universal problem solver (and problem creator).",
  "🤷 SQL injection isn't a bug, it's a feature — if you're the attacker.",
  "🧙‍♂️ A developer's password: correct horse battery staple... wait, everyone knows that now.",
  "🗝️ I use ROT13 encryption — twice, for double security.",
  "🔥 This is fine. 🐕☕ (server room on fire)",
];

const memeHandler: CommandHandler = async () => {
  return {
    success: true,
    message: MEMES[secureRandom(MEMES.length)],
    ephemeral: false,
  };
};

// ── /xp ─────────────────────────────────────────────────────────────────────

const xpCommand: SlashCommand = {
  name: "xp",
  description: "Check your XP and level",
  category: "fun",
  params: [
    { name: "user", description: "User to check (default: yourself)", type: "user", required: false },
  ],
  serverOnly: true,
};

const xpHandler: CommandHandler = async (args, ctx) => {
  const user = args.user ?? ctx.username;
  // This would fetch from DB in production
  const xp = secureRandom(5000);
  const level = Math.floor(Math.sqrt(xp / 100));
  const nextLevelXp = (level + 1) ** 2 * 100;
  const progress = Math.round((xp / nextLevelXp) * 100);

  const bar = "█".repeat(Math.floor(progress / 10)) + "░".repeat(10 - Math.floor(progress / 10));
  return {
    success: true,
    message: `📊 **${user}** — Level **${level}** (${xp} XP)\n[${bar}] ${progress}% to level ${level + 1} (${nextLevelXp} XP)`,
    ephemeral: false,
    data: { xp, level, nextLevelXp },
  };
};

// ── /leaderboard ────────────────────────────────────────────────────────────

const leaderboardCommand: SlashCommand = {
  name: "leaderboard",
  description: "View the server XP leaderboard",
  category: "fun",
  params: [],
  serverOnly: true,
};

const leaderboardHandler: CommandHandler = async (_args, ctx) => {
  // In production, this fetches from the DB
  return {
    success: true,
    message: `🏆 **Server Leaderboard**\n_Loading leaderboard data..._`,
    ephemeral: false,
    data: { action: "leaderboard", serverId: ctx.serverId },
  };
};

// ── Registration ────────────────────────────────────────────────────────────

export function registerFunCommands(): void {
  registerCommand(coinflipCommand, coinflipHandler);
  registerCommand(rollCommand, rollHandler);
  registerCommand(eightballCommand, eightballHandler);
  registerCommand(rpsCommand, rpsHandler);
  registerCommand(guessCommand, guessHandler);
  registerCommand(mathCommand, mathHandler);
  registerCommand(triviaCommand, triviaHandler);
  registerCommand(memeCommand, memeHandler);
  registerCommand(xpCommand, xpHandler);
  registerCommand(leaderboardCommand, leaderboardHandler);
}
