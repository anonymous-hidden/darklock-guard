const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('fun')
        .setDescription('Fun and entertainment commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('8ball')
                .setDescription('Ask the magic 8-ball a question')
                .addStringOption(option =>
                    option.setName('question')
                        .setDescription('Your yes/no question')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('dice')
                .setDescription('Roll dice')
                .addIntegerOption(option =>
                    option.setName('sides')
                        .setDescription('Number of sides on the die (default: 6)')
                        .setMinValue(2)
                        .setMaxValue(100)
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('count')
                        .setDescription('Number of dice to roll (default: 1)')
                        .setMinValue(1)
                        .setMaxValue(10)
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('coinflip')
                .setDescription('Flip a coin'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('avatar')
                .setDescription('Display a user\'s avatar')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('User to show avatar of (default: you)')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('meme')
                .setDescription('Get a random meme from Reddit'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('joke')
                .setDescription('Get a random joke'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('poll')
                .setDescription('Create a poll')
                .addStringOption(option =>
                    option.setName('question')
                        .setDescription('Poll question')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('option1')
                        .setDescription('First option')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('option2')
                        .setDescription('Second option')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('option3')
                        .setDescription('Third option')
                        .setRequired(false))
                .addStringOption(option =>
                    option.setName('option4')
                        .setDescription('Fourth option')
                        .setRequired(false))
                .addIntegerOption(option =>
                    option.setName('duration')
                        .setDescription('Poll duration in minutes (default: 60)')
                        .setMinValue(1)
                        .setMaxValue(10080)
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('rps')
                .setDescription('Play Rock, Paper, Scissors')
                .addStringOption(option =>
                    option.setName('choice')
                        .setDescription('Your choice')
                        .setRequired(true)
                        .addChoices(
                            { name: '🪨 Rock', value: 'rock' },
                            { name: '📄 Paper', value: 'paper' },
                            { name: '✂️ Scissors', value: 'scissors' }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('rate')
                .setDescription('Rate something out of 10')
                .addStringOption(option =>
                    option.setName('thing')
                        .setDescription('What to rate')
                        .setRequired(true))),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case '8ball':
                await handle8Ball(interaction);
                break;
            case 'dice':
                await handleDice(interaction);
                break;
            case 'coinflip':
                await handleCoinFlip(interaction);
                break;
            case 'avatar':
                await handleAvatar(interaction);
                break;
            case 'meme':
                await handleMeme(interaction);
                break;
            case 'joke':
                await handleJoke(interaction);
                break;
            case 'poll':
                await handlePoll(interaction);
                break;
            case 'rps':
                await handleRPS(interaction);
                break;
            case 'rate':
                await handleRate(interaction);
                break;
            default:
                await interaction.reply({ content: '❌ Unknown fun command.', ephemeral: true });
        }
    }
};

// 8ball responses
const eightBallResponses = {
    positive: [
        'It is certain.',
        'It is decidedly so.',
        'Without a doubt.',
        'Yes - definitely.',
        'You may rely on it.',
        'As I see it, yes.',
        'Most likely.',
        'Outlook good.',
        'Yes.',
        'Signs point to yes.'
    ],
    neutral: [
        'Reply hazy, try again.',
        'Ask again later.',
        'Better not tell you now.',
        'Cannot predict now.',
        'Concentrate and ask again.'
    ],
    negative: [
        'Don\'t count on it.',
        'My reply is no.',
        'My sources say no.',
        'Outlook not so good.',
        'Very doubtful.'
    ]
};

async function handle8Ball(interaction) {
    const question = interaction.options.getString('question');
    
    const allResponses = [...eightBallResponses.positive, ...eightBallResponses.neutral, ...eightBallResponses.negative];
    const response = allResponses[Math.floor(Math.random() * allResponses.length)];
    
    let color;
    if (eightBallResponses.positive.includes(response)) color = '#00ff00';
    else if (eightBallResponses.negative.includes(response)) color = '#ff0000';
    else color = '#ffaa00';

    const embed = new EmbedBuilder()
        .setTitle('🎱 Magic 8-Ball')
        .setColor(color)
        .addFields(
            { name: 'Question', value: question, inline: false },
            { name: 'Answer', value: response, inline: false }
        )
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

async function handleDice(interaction) {
    const sides = interaction.options.getInteger('sides') || 6;
    const count = interaction.options.getInteger('count') || 1;

    const rolls = [];
    let total = 0;
    
    for (let i = 0; i < count; i++) {
        const roll = Math.floor(Math.random() * sides) + 1;
        rolls.push(roll);
        total += roll;
    }

    const embed = new EmbedBuilder()
        .setTitle('🎲 Dice Roll')
        .setColor('#5865F2')
        .setDescription(`Rolling ${count}d${sides}`)
        .addFields(
            { name: 'Results', value: rolls.join(', '), inline: false },
            { name: 'Total', value: total.toString(), inline: false }
        )
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

async function handleCoinFlip(interaction) {
    const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
    const emoji = result === 'Heads' ? '🪙' : '💿';

    const embed = new EmbedBuilder()
        .setTitle('🪙 Coin Flip')
        .setColor('#ffd700')
        .setDescription(`${emoji} **${result}!**`)
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

async function handleAvatar(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    
    const embed = new EmbedBuilder()
        .setTitle(`${user.username}'s Avatar`)
        .setColor('#5865F2')
        .setImage(user.displayAvatarURL({ dynamic: true, size: 1024 }))
        .setDescription(`[Download](${user.displayAvatarURL({ dynamic: true, size: 1024 })})`)
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

async function handleMeme(interaction) {
    await interaction.deferReply();

    try {
        const subreddits = ['memes', 'dankmemes', 'me_irl', 'wholesomememes', 'funny'];
        const subreddit = subreddits[Math.floor(Math.random() * subreddits.length)];
        
        const response = await fetch(`https://www.reddit.com/r/${subreddit}/top.json?limit=50&t=day`, {
            headers: { 'User-Agent': 'DarkLock-Bot/1.0' }
        });
        const data = await response.json();
        
        if (!data?.data?.children?.length) {
            throw new Error('No meme found');
        }

        // Filter to image posts only
        const imagePosts = data.data.children
            .map(c => c.data)
            .filter(p => !p.is_video && !p.is_gallery && !p.over_18 && (p.url?.match(/\.(jpg|jpeg|png|gif|webp)$/i) || p.url?.includes('i.redd.it')));

        if (imagePosts.length === 0) {
            throw new Error('No image memes found');
        }

        const post = imagePosts[Math.floor(Math.random() * imagePosts.length)];

        const embed = new EmbedBuilder()
            .setTitle(post.title.length > 256 ? post.title.substring(0, 253) + '...' : post.title)
            .setColor('#ff4500')
            .setImage(post.url)
            .setFooter({ text: `👍 ${post.ups} | r/${subreddit}` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Meme fetch error:', error);
        await interaction.editReply({ content: '❌ Failed to fetch a meme. Please try again!' });
    }
}

async function handleJoke(interaction) {
    await interaction.deferReply();

    try {
        const response = await fetch('https://official-joke-api.appspot.com/random_joke');
        const joke = await response.json();

        const embed = new EmbedBuilder()
            .setTitle('😂 Random Joke')
            .setColor('#ffaa00')
            .setDescription(`${joke.setup}\n\n||${joke.punchline}||`)
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Joke fetch error:', error);
        
        // Fallback jokes
        const fallbackJokes = [
            { setup: 'Why did the scarecrow win an award?', punchline: 'Because he was outstanding in his field!' },
            { setup: 'What do you call a fake noodle?', punchline: 'An impasta!' },
            { setup: 'Why don\'t scientists trust atoms?', punchline: 'Because they make up everything!' },
            { setup: 'What did the ocean say to the beach?', punchline: 'Nothing, it just waved!' },
            { setup: 'Why did the bicycle fall over?', punchline: 'Because it was two tired!' }
        ];
        
        const joke = fallbackJokes[Math.floor(Math.random() * fallbackJokes.length)];
        
        const embed = new EmbedBuilder()
            .setTitle('😂 Random Joke')
            .setColor('#ffaa00')
            .setDescription(`${joke.setup}\n\n||${joke.punchline}||`)
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    }
}

async function handlePoll(interaction) {
    await interaction.deferReply();
    
    const question = interaction.options.getString('question');
    const options = [
        interaction.options.getString('option1'),
        interaction.options.getString('option2'),
        interaction.options.getString('option3'),
        interaction.options.getString('option4')
    ].filter(o => o !== null);

    const duration = interaction.options.getInteger('duration') || 60;
    const endTime = new Date(Date.now() + duration * 60000);

    const embed = new EmbedBuilder()
        .setTitle('📊 ' + question)
        .setColor('#5865F2')
        .setDescription(options.map((opt, i) => `${['1️⃣', '2️⃣', '3️⃣', '4️⃣'][i]} ${opt}`).join('\n\n'))
        .setFooter({ text: `Poll ends at ${endTime.toLocaleTimeString()} | ${duration} minutes` })
        .setTimestamp();

    const msg = await interaction.editReply({
        embeds: [embed],
        fetchReply: true
    });

    const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'].slice(0, options.length);
    for (const emoji of emojis) {
        await msg.react(emoji);
    }

    // Store poll in database
    const bot = interaction.client.bot;
    try {
        await bot.database.run(`
            INSERT INTO polls (guild_id, channel_id, message_id, question, options, creator_id, ends_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `, [interaction.guild.id, interaction.channel.id, msg.id, question, JSON.stringify(options), interaction.user.id, endTime.toISOString()]);
    } catch (error) {
        console.error('Failed to store poll:', error);
    }
}

async function handleRPS(interaction) {
    const userChoice = interaction.options.getString('choice');
    const choices = ['rock', 'paper', 'scissors'];
    const botChoice = choices[Math.floor(Math.random() * choices.length)];

    const emojis = {
        rock: '🪨',
        paper: '📄',
        scissors: '✂️'
    };

    let result;
    let color;
    
    if (userChoice === botChoice) {
        result = '🤝 It\'s a tie!';
        color = '#ffaa00';
    } else if (
        (userChoice === 'rock' && botChoice === 'scissors') ||
        (userChoice === 'paper' && botChoice === 'rock') ||
        (userChoice === 'scissors' && botChoice === 'paper')
    ) {
        result = '🎉 You win!';
        color = '#00ff00';
    } else {
        result = '😢 You lose!';
        color = '#ff0000';
    }

    const embed = new EmbedBuilder()
        .setTitle('🎮 Rock, Paper, Scissors')
        .setColor(color)
        .addFields(
            { name: 'Your Choice', value: `${emojis[userChoice]} ${userChoice}`, inline: true },
            { name: 'Bot Choice', value: `${emojis[botChoice]} ${botChoice}`, inline: true },
            { name: 'Result', value: result, inline: false }
        )
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

async function handleRate(interaction) {
    const thing = interaction.options.getString('thing');
    const rating = Math.floor(Math.random() * 11); // 0-10

    let emoji;
    if (rating <= 3) emoji = '😢';
    else if (rating <= 5) emoji = '😐';
    else if (rating <= 7) emoji = '🙂';
    else if (rating <= 9) emoji = '😄';
    else emoji = '🤩';

    const embed = new EmbedBuilder()
        .setTitle('⭐ Rating')
        .setColor('#ffd700')
        .setDescription(`${emoji} I'd rate **${thing}** a **${rating}/10**!`)
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}
