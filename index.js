const { Client, GatewayIntentBits, Collection, REST, Routes, EmbedBuilder, MessageFlags } = require('discord.js');
const fs = require('fs');
const stringSimilarity = require("string-similarity");
// Gestion MySQL via DAO
const { pool, getSharedConnection } = require('./utils/dbManager');
const UserDao = require('./dao/userDao');
const UserCoasterDao = require('./dao/userCoasterDao');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const successMessages = [
    "🎯 Spot on! Great job! 🚀",
    "🌟 Nailed it! Well done! 🎉",
    "🌀 You crushed it! Let’s go! 🎢",
    "💡 Bingo! You're on fire! 🔥",
    "🎯 Direct hit! Impressive guess! 🧠",
    "🚀 Sky high! That was fast! ✨",
    "🏁 You nailed that turn! GG! 🏎️",
    "🌈 Perfect match! Well played! 🧩",
    "💥 Bullseye! Right on track! 🎯",
    "🤩 Legendary guess! You're unstoppable! 🌟"
];

client.commands = new Collection();
client.activeGuesses = {};
client.currentCompetition = null;


// Lecture des commandes
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
const commandsData = [];

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.data.name, command);
    commandsData.push(command.data.toJSON());
}

// Connexion MySQL via le pool (dbManager)
client.db = pool;
// Si besoin d'une connexion partagée : await getSharedConnection();

// Déploiement des commandes slash
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
(async () => {
    try {
        console.log('Déploiement global des commandes slash...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commandsData }
        );
        console.log('Commandes slash enregistrées globalement !');
    } catch (error) {
        console.error('Erreur lors du déploiement des commandes :', error);
    }
})();

// Gestion des interactions
client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction, client);
    } catch (error) {
        console.error(error);
        await interaction.reply({ content: 'Erreur lors de l’exécution de la commande.', flags: MessageFlags.Ephemeral });
    }
});

// Bot prêt
client.once('ready', () => {
    console.log(`🤖 Bot connecté en tant que ${client.user.tag}`);

    
    const statuses = [
        "🎢 Guess the coaster",
        "🧠 Challenging your coaster knowledge",
        "⏱️ Name that ride before time runs out",
        "💯 Analyzing launch speed and track layout",
        "⏳ You're on the clock. Ready?",
        "✨ Decoding coaster clues",
        "🚀 From zero to 120km/h!",
        "🌀 Ride loading... hold tight!"
    ];
    

    let index = 0;

    // Update every 15 secondes
    setInterval(() => {
        client.user.setPresence({
            activities: [{
                name: statuses[index % statuses.length],
                type: 5
            }],
            status: 'online'
        });
        index++;
    }, 15000);
});


client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // 🎉 Mode Compétition (tout le monde peut participer)
    if (client.currentCompetition && Date.now() < client.currentCompetition.timeout) {
        const guess = message.content.toLowerCase().trim();
        const validAnswers = [
            client.currentCompetition.name.toLowerCase(),
            client.currentCompetition.alias?.toLowerCase()
        ].filter(Boolean);

        // Vérification exacte d'abord
        let isCorrect = validAnswers.some(answer => guess.includes(answer));
        let correctAnswer = null;

        // Si pas de correspondance exacte, vérifier la similarité
        if (!isCorrect) {
            const similarity = stringSimilarity.findBestMatch(guess, validAnswers);
            if (similarity.bestMatch.rating >= 0.7) { // Seuil de 70% de similarité
                isCorrect = true;
                correctAnswer = similarity.bestMatch.target;
            }
        }

        if (isCorrect) {
            const username = message.author.username;
            const coasterName = client.currentCompetition.name;

            // Marquer immédiatement qu'il y a un gagnant pour empêcher le timeout
            client.currentCompetition.hasWinner = true;

            // Utilisation du DAO pour la compétition
            (async () => {
                try {
                    await UserDao.insertIfNotExists({ username, guildId: message.guildId });
                    await UserCoasterDao.insertIfNotExists({ username, coasterName });
                    await UserDao.updateCompetitionWinner({ username });

                    const embed = new EmbedBuilder()
                        .setColor(0xf1c40f)
                        .setTitle("🏆 Competition Won!")
                        .setDescription(`**${username}** was the first to guess **${coasterName}**!${correctAnswer ? `\n📝 *Correct answer: ${correctAnswer}*` : ''}`)
                        .addFields({
                            name: '<:trophe:1368024238371508315> Reward',
                            value: `+5 credits & unlocked the competition badge!`,
                            inline: true
                        });

                    await message.channel.send({ embeds: [embed] });

                    // 🛠 Met à jour l'embed initial de la compétition
                    if (client.currentCompetition && client.currentCompetition.message) {
                        const originalEmbed = client.currentCompetition.message.embeds?.[0];
                        if (originalEmbed) {
                            const updatedEmbed = EmbedBuilder.from(originalEmbed)
                                .setDescription(
                                    `✅ The coaster was guessed by **${username}**!\n\n` +
                                    '🎯 Be the **first** to guess the name of this coaster.\n' +
                                    '<:competition_winner:1368317089156169739> Winner gets **+5 credits** and the **Competition Badge**!'
                                )
                                .setFooter({ text: '🏁 Competition over!' });
                            client.currentCompetition.message.edit({ embeds: [updatedEmbed] }).catch(console.error);
                        }
                    }

                    // ✅ Nettoyer la compétition après avoir mis à jour l'embed
                    client.currentCompetition = null;
                } catch (err) {
                    console.error('Error handling competition winner:', err);
                }
            })();

            return; // ✅ ne pas continuer avec le système normal
        }

        return; // mauvaise réponse en compétition : rien ne se passe
    }

    // 🎯 Système classique (guess personnel)
    const userGuess = client.activeGuesses[message.author.id];
    if (!userGuess || Date.now() > userGuess.timeout) {
        delete client.activeGuesses[message.author.id];
        return;
    }

    const guess = message.content.toLowerCase().trim();
    const validAnswers = [
        userGuess.name.toLowerCase(),
        userGuess.alias?.toLowerCase()
    ].filter(Boolean);

    // Vérification exacte d'abord
    let isCorrect = validAnswers.some(answer => guess.includes(answer));
    let correctAnswer = null;

    // Si pas de correspondance exacte, vérifier la similarité
    if (!isCorrect) {
        const similarity = stringSimilarity.findBestMatch(guess, validAnswers);
        if (similarity.bestMatch.rating >= 0.8) { // Seuil de 80% de similarité
            isCorrect = true;
            correctAnswer = similarity.bestMatch.target;
        }
    }

    if (!isCorrect) return;

    const username = message.author.username;
    const coasterName = userGuess.name;
    const difficulty = userGuess.difficulty?.toLowerCase() || "easy";

    let creditGain = 1;
    if (difficulty === "medium") creditGain = 2;
    else if (difficulty === "hard") creditGain = 3;

    // Utilisation des DAO pour le système classique
    (async () => {
        try {
            await UserCoasterDao.insertIfNotExists({ username, coasterName });
            await UserDao.insertClassicIfNotExists({ username, guildId: message.guildId });
            await UserDao.updateClassicStats({ username, creditGain });
            const stats = await UserDao.getStats({ username });
            if (stats && stats.streak > stats.best_streak) {
                await UserDao.updateBestStreak({ username, streak: stats.streak });
            }
            const randomMessage = successMessages[Math.floor(Math.random() * successMessages.length)];
            const embed = new EmbedBuilder()
                .setColor(0x2ecc71)
                .setTitle(randomMessage)
                .setDescription(`**${username}** guessed "**${coasterName}**" correctly!${correctAnswer ? `\n📝 *Correct answer: ${correctAnswer}*` : ''}`)
                .addFields(
                    { name: '<a:Medaille:1367883558839914516> Crédit(s)', value: `+${creditGain}`, inline: true },
                    { name: '🔥 Streak', value: `${stats ? stats.streak : 0}`, inline: true }
                );
            await message.reply({ embeds: [embed] });
            delete client.activeGuesses[message.author.id];
        } catch (err) {
            console.error(err);
        }
    })();
});



client.login(process.env.DISCORD_TOKEN);
