const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('competition')
        .setDescription('Start a public guessing round — first to guess wins +5 credits and a badge!'),

    async execute(interaction, client) {
        if (client.currentCompetition && Date.now() < client.currentCompetition.timeout) {
            return interaction.reply({
                content: 'A competition is already in progress!',
                ephemeral: true
            });
        }

        client.db.query(`SELECT * FROM coasters ORDER BY RAND() LIMIT 1`, async (err, results) => {
            if (err || results.length === 0) {
                console.error(err);
                return interaction.reply({
                    content: 'Failed to fetch a coaster from the database.',
                    ephemeral: true
                });
            }

            const coaster = results[0];
            let secondsLeft = 60;

            const createEmbed = (timeDisplay) => {
                return new EmbedBuilder()
                    .setTitle('🏁 Competition Time!')
                    .setDescription(
                        'A public guessing round has started!\n\n' +
                        '🎯 Be the **first** to guess the name of this coaster.\n' +
                        '<:competition_winner:1368317089156169739> Winner gets **+5 credits** and the **Competition Badge**!\n\n' +
                        timeDisplay
                    )
                    .setImage(coaster.image_url)
                    .setColor(0xe67e22)
                    .setFooter({ text: 'Type your guess now!' });
            };

            // Initial reply
            await interaction.reply({ embeds: [createEmbed(`Time left: **${secondsLeft}s**`)] });
            const replyMessage = await interaction.fetchReply();

            client.currentCompetition = {
                name: coaster.name,
                alias: coaster.alias,
                difficulty: coaster.difficulty,
                timeout: Date.now() + secondsLeft * 1000,
                hasWinner: false,
                message: replyMessage
            };

            const interval = setInterval(() => {
                secondsLeft--;

                const active = client.currentCompetition;
                if (!active || secondsLeft <= 0 || Date.now() > active.timeout) {
                    clearInterval(interval);
                    interaction.editReply({ embeds: [createEmbed(`⏱️ Time's up!`)] }).catch(console.error);
                    return;
                }

                interaction.editReply({ embeds: [createEmbed(`Time left: **${secondsLeft}s**`)] }).catch(console.error);
            }, 1000);

            setTimeout(() => {
                const active = client.currentCompetition;
                if (active && !active.hasWinner && Date.now() > active.timeout) {
                    client.currentCompetition = null;

                    const timeoutEmbed = new EmbedBuilder()
                        .setTitle("⏱️ Time's Up!")
                        .setDescription("Nobody guessed the coaster in time.")
                        .setColor(0xd9534f);

                    interaction.followUp({ embeds: [timeoutEmbed] }).catch(console.error);
                }
            }, secondsLeft * 1000);
        });
    }
};
