const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const UserDao = require('../dao/userDao');
const UserCoasterDao = require('../dao/userCoasterDao');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('Returns a User\'s GuessTheCoaster Profile')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The Tag of the User\'s Profile to Display')
                .setRequired(false)
        ),

    async execute(interaction, client) {
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const username = targetUser.username;
        const avatar = targetUser.displayAvatarURL();

        try {
            const profile = await UserDao.getProfile({ username });
            if (!profile) {
                const notFoundEmbed = new EmbedBuilder()
                    .setTitle('User Profile Not Found!')
                    .setDescription('This user has never played before.\nStart by using the **/guess** command to create a profile!')
                    .setColor(0xd9534f);
                return interaction.reply({ embeds: [notFoundEmbed], flags: MessageFlags.Ephemeral });
            }

            const { credits, streak, best_streak, contributor, competition_winner, has_completed } = profile;

            // Requête 1 : coasters collectés par difficulté
            const [collectedResults] = await client.db.query(`
                SELECT c.difficulty, COUNT(*) AS count
                FROM user_coasters uc
                JOIN coasters c ON uc.coaster_id = c.id
                WHERE uc.username = ?
                GROUP BY c.difficulty
            `, [username]);

            // Requête 2 : coasters totaux par difficulté
            const [totalResults] = await client.db.query(`
                SELECT difficulty, COUNT(*) AS total
                FROM coasters
                GROUP BY difficulty
            `);

            const difficulties = ['Easy', 'Medium', 'Hard'];
            const collectedMap = Object.fromEntries(difficulties.map(d => [d, 0]));
            const totalMap = Object.fromEntries(difficulties.map(d => [d, 0]));

            for (const row of collectedResults) {
                collectedMap[row.difficulty] = row.count;
            }
            for (const row of totalResults) {
                totalMap[row.difficulty] = row.total;
            }

            const totalCoasters = totalMap.Easy + totalMap.Medium + totalMap.Hard;
            const totalCollected = collectedMap.Easy + collectedMap.Medium + collectedMap.Hard;
            const completion = ((totalCollected / totalCoasters) * 100).toFixed(2);
            
            if (parseFloat(completion) === 100 && profile.has_completed === 0) {
                await client.db.query(
                    `UPDATE users SET has_completed = 1 WHERE username = ?`,
                    [username]
                );
            }

            // 🏅 Badges dynamiques
            let badges = '';
            if (completion >= 50) badges += '<:50Completion:1367798353559027824> ';
            if (completion == 100 || profile.has_completed === 1) {
                badges += '<:100Completion:1367798366116773979> ';
            }
            if (best_streak >= 10) badges += '<:10Streak:1367800181709471824> ';
            if (best_streak >= 50) badges += '<:50Streak:1367800333144821801> ';
            if (contributor === 1) badges += '<:contributor:1367796340725383221> ';
            if (competition_winner === 1) badges += '<:competition_winner:1368317089156169739>';
            if (username.toLowerCase() === 'cybertrist') badges += '<:Owner:1367800341676167208> ';
            if (credits >= 10000) badges += '<:MicroCoaster:1368326557432680559> ';

            const embed = new EmbedBuilder()
                .setTitle(`${username}'s Profile`)
                .setColor(0x1abc9c)
                .setThumbnail(avatar)
                .setDescription(
                    `Credits: **${credits}** 🪙\n` +
                    `Completion: **${completion}%**\n` +
                    `Collected: **${totalCollected}/${totalCoasters}**\n` +
                    `Best Streak: **${best_streak}** 🔥`
                )
                .addFields(
                    { name: 'Easy', value: `${collectedMap.Easy}/${totalMap.Easy}`, inline: true },
                    { name: 'Medium', value: `${collectedMap.Medium}/${totalMap.Medium}`, inline: true },
                    { name: 'Hard', value: `${collectedMap.Hard}/${totalMap.Hard}`, inline: true },
                    { name: 'Badges', value: badges || '*None! 😢*' }
                )
                .setTimestamp();

            interaction.reply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            interaction.reply({
                content: 'An error occurred while fetching profile data.',
                flags: MessageFlags.Ephemeral
            });
        }
    }
};
