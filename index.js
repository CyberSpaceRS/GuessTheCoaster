const { Client, GatewayIntentBits, Collection, REST, Routes, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const mysql = require('mysql2');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.commands = new Collection();
client.activeGuesses = {}; // Pour suivre les guesses en cours

// Lecture des commandes
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
const commandsData = [];

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.data.name, command);
    commandsData.push(command.data.toJSON());
}

// Connexion MySQL
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
});
db.connect(err => {
    if (err) throw err;
    console.log('✅ Connecté à MySQL');
});
client.db = db;

// Déploiement des commandes slash
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
(async () => {
    try {
        console.log('📡 Déploiement global des commandes slash...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commandsData }
        );
        console.log('✅ Commandes slash enregistrées globalement !');
    } catch (error) {
        console.error('❌ Erreur lors du déploiement des commandes :', error);
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
        await interaction.reply({ content: '❌ Erreur lors de l’exécution de la commande.', ephemeral: true });
    }
});

// Message de confirmation quand le bot est prêt
client.once('ready', () => {
    console.log(`🤖 Bot connecté en tant que ${client.user.tag}`);
});

// 🎯 Détection des bonnes réponses utilisateur
client.on('messageCreate', async message => {
    if (message.author.bot || !client.activeGuesses[message.author.id]) return;

    const userGuess = client.activeGuesses[message.author.id];
    if (!userGuess || Date.now() > userGuess.timeout) return;
    const guess = message.content.toLowerCase().trim();

    const validAnswers = [
        userGuess.name.toLowerCase(),
        userGuess.alias?.toLowerCase()
    ].filter(Boolean);

    const isCorrect = validAnswers.some(answer => guess.includes(answer));
    if (!isCorrect) return;

    const username = message.author.username;
    const coasterName = userGuess.name;

    client.db.query(`
        INSERT IGNORE INTO user_coasters (username, coaster_id)
        SELECT ?, id FROM coasters WHERE LOWER(name) = ? OR LOWER(alias) = ?
    `, [username, coasterName.toLowerCase(), coasterName.toLowerCase()]);
    

    client.db.query(`
        INSERT INTO users (username, credits, streak, best_streak, guild_id)
        VALUES (?, 1, 1, 1, ?)
        ON DUPLICATE KEY UPDATE 
            credits = credits + 1, 
            streak = streak + 1,
            best_streak = GREATEST(best_streak, streak),
            guild_id = VALUES(guild_id),
            last_played = NOW()
    `, [username, message.guildId], err => {
        if (err) return console.error(err);
    
        client.db.query(
            `SELECT credits, streak, best_streak FROM users WHERE username = ?`,
            [username],
            (err, rows) => {
                if (err || rows.length === 0) return;
    
                const { credits, streak, best_streak } = rows[0];
    
                const embed = new EmbedBuilder()
                    .setColor(0x2ecc71)
                    .setTitle('GG!')
                    .setDescription(`**${username}** guessed "**${coasterName}**" correctly!`)
                    .addFields(
                        { name: '🏅 Crédit(s)', value: '+1', inline: true },
                        { name: '🔥 Streak', value: `${streak}`, inline: true }
                    );
    
                message.reply({ embeds: [embed] });
            }
        );
    });
    
    

    delete client.activeGuesses[message.author.id];
});

client.login(process.env.DISCORD_TOKEN);