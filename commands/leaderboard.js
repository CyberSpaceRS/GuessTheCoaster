const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Returns the browsable Leaderboards for GuessTheCoaster'),

    async execute(interaction, client) {
        const guildId = interaction.guildId;

        const totalCoasters = await new Promise((resolve) => {
            client.db.query(`SELECT COUNT(*) as total FROM coasters`, (err, res) => {
                if (err) return resolve(0);
                resolve(res[0].total);
            });
        });

        const fetchData = (query, params = []) => {
            return new Promise((resolve) => {
                client.db.query(query, params, (err, rows) => {
                    if (err) {
                        console.error(err);
                        return resolve([]);
                    }
                    resolve(rows);
                });
            });
        };

        const globalCredits = await fetchData(`SELECT username, credits FROM users ORDER BY credits DESC LIMIT 10`);
        const globalCompletion = await fetchData(`
            SELECT u.username, COUNT(DISTINCT uc.coaster_id) AS collected
            FROM user_coasters uc
            JOIN users u ON u.username = uc.username
            GROUP BY uc.username
            ORDER BY collected DESC
            LIMIT 10
        `);
        const globalStreak = await fetchData(`SELECT username, best_streak FROM users ORDER BY best_streak DESC LIMIT 10`);

        const localCredits = await fetchData(`
            SELECT username, credits FROM users 
            WHERE guild_id = ? ORDER BY credits DESC LIMIT 10`, [guildId]);
        const localCompletion = await fetchData(`
            SELECT u.username, COUNT(DISTINCT uc.coaster_id) AS collected
            FROM user_coasters uc
            JOIN users u ON u.username = uc.username
            WHERE u.guild_id = ?
            GROUP BY uc.username
            ORDER BY collected DESC
            LIMIT 10
        `, [guildId]);
        const localStreak = await fetchData(`
            SELECT username, best_streak FROM users 
            WHERE guild_id = ? ORDER BY best_streak DESC LIMIT 10`, [guildId]);

        const formatList = (list, label) => {
            return list.map((row, i) => {
                let value = row.credits || row.best_streak || row.collected || 0;
                if (label === 'completion') {
                    const percent = ((value / totalCoasters) * 100).toFixed(2);
                    return `**${i + 1})** ${row.username} | **${percent}%** Completion`;
                }
                return `**${i + 1})** ${row.username} | **${value}** ${label === 'streak' ? 'Streak' : 'Credits'}`;
            }).join('\n') || "*Not enough data yet!*";
        };

        const createEmbeds = (scope, color) => {
            const credits = scope === 'Global' ? globalCredits : localCredits;
            const completion = scope === 'Global' ? globalCompletion : localCompletion;
            const streaks = scope === 'Global' ? globalStreak : localStreak;

            return [
                new EmbedBuilder()
                    .setTitle(`${scope === 'Global' ? '📕' : '📘'} ${scope} Leaderboard`)
                    .addFields(
                        { name: `Top ${credits.length} Credits ✨`, value: formatList(credits, 'credits') },
                        { name: `Top ${completion.length} Completion <:trophe:1368024238371508315>`, value: formatList(completion, 'completion') }
                    )
                    .setFooter({ text: 'Page 1/2  •  Buttons expire after 30 seconds' })
                    .setColor(color)
                    .setTimestamp(),
                new EmbedBuilder()
                    .setTitle(`${scope === 'Global' ? '📕' : '📘'} ${scope} Leaderboard`)
                    .addFields(
                        { name: `Top ${streaks.length} Streaks 🔥`, value: formatList(streaks, 'streak') }
                    )
                    .setFooter({ text: 'Page 2/2  •  Buttons expire after 30 seconds' })
                    .setColor(color)
                    .setTimestamp()
            ];
        };

        const makeButtons = (scope = 'Global', page = 1) => {
            const backId = scope === 'Global' ? 'global1' : 'local1';
            const forwardId = scope === 'Global' ? 'global2' : 'local2';
            const switchId = scope === 'Global' ? 'local' : 'global';
            const color = scope === 'Global' ? 0xdd2e44 : 0x55acee;

            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(backId).setLabel('←').setStyle(1).setDisabled(page === 1),
                new ButtonBuilder().setCustomId(switchId).setLabel(scope === 'Global' ? 'Show Local' : 'Show Global').setStyle(3),
                new ButtonBuilder().setCustomId(forwardId).setLabel('→').setStyle(1).setDisabled(page === 2)
            );

            return { buttons, color };
        };

        let currentScope = 'Global';
        let currentPage = 1;

        const { buttons, color } = makeButtons(currentScope, currentPage);
        const embeds = createEmbeds(currentScope, color);

        const reply = await interaction.reply({
            embeds: [embeds[0]],
            components: [buttons]
        });

        const collector = reply.createMessageComponentCollector({ time: 30000 });

        collector.on('collect', async btn => {
            await btn.deferUpdate();

            switch (btn.customId) {
                case 'global2':
                    currentScope = 'Global';
                    currentPage = 2;
                    break;
                case 'global1':
                    currentScope = 'Global';
                    currentPage = 1;
                    break;
                case 'local':
                    currentScope = 'Local';
                    currentPage = 1;
                    break;
                case 'local2':
                    currentScope = 'Local';
                    currentPage = 2;
                    break;
                case 'local1':
                    currentScope = 'Local';
                    currentPage = 1;
                    break;
                case 'global':
                    currentScope = 'Global';
                    currentPage = 1;
                    break;
            }

            const { buttons, color } = makeButtons(currentScope, currentPage);
            const embeds = createEmbeds(currentScope, color);

            await reply.edit({
                embeds: [embeds[currentPage - 1]],
                components: [buttons]
            });
        });

        collector.on('end', () => {
            reply.edit({ components: [] });
        });
    }
};
