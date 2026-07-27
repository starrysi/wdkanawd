const { Client, GatewayIntentBits, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const express = require('express');
const crypto = require('crypto');

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID || '1531095882983014572';
const PORT = process.env.PORT || 3000;

if (!TOKEN) {
    console.error('Missing DISCORD_TOKEN env var');
    process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const app = express();
app.use(express.json());

const pending = new Map();

client.once('ready', () => console.log(`Bot ready as ${client.user.tag}`));

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.channelId !== CHANNEL_ID) return;

    const requestId = interaction.message.id;
    const resolver = pending.get(requestId);
    if (!resolver) {
        await interaction.reply({ content: 'Expired.', ephemeral: true });
        return;
    }

    clearTimeout(resolver.timeout);
    pending.delete(requestId);

    if (interaction.customId === 'confirm_device') {
        await interaction.update({
            content: '**Perm Accept**',
            components: [
                new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder().setCustomId('confirm_device').setLabel('Confirm Device').setStyle(ButtonStyle.Success).setDisabled(true),
                        new ButtonBuilder().setCustomId('revoke_device').setLabel('Revoke').setStyle(ButtonStyle.Danger).setDisabled(true)
                    )
            ]
        });
        resolver.resolve({ status: 'accepted' });
    } else if (interaction.customId === 'revoke_device') {
        await interaction.update({
            content: '**Perm Cancel**',
            components: [
                new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder().setCustomId('confirm_device').setLabel('Confirm Device').setStyle(ButtonStyle.Success).setDisabled(true),
                        new ButtonBuilder().setCustomId('revoke_device').setLabel('Revoke').setStyle(ButtonStyle.Danger).setDisabled(true)
                    )
            ]
        });
        resolver.resolve({ status: 'denied' });
    }
});

app.post('/auth', async (req, res) => {
    try {
        const channel = await client.channels.fetch(CHANNEL_ID);
        const msg = await channel.send({
            content: '**Authorization Required**',
            components: [
                new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder().setCustomId('confirm_device').setLabel('Confirm Device').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId('revoke_device').setLabel('Revoke').setStyle(ButtonStyle.Danger)
                    )
            ]
        });

        const result = await new Promise((resolve) => {
            const timeout = setTimeout(async () => {
                pending.delete(msg.id);
                try {
                    await msg.edit({
                        content: '**No Perm Accept**',
                        components: [
                            new ActionRowBuilder()
                                .addComponents(
                                    new ButtonBuilder().setCustomId('confirm_device').setLabel('Confirm Device').setStyle(ButtonStyle.Success).setDisabled(true),
                                    new ButtonBuilder().setCustomId('revoke_device').setLabel('Revoke').setStyle(ButtonStyle.Danger).setDisabled(true)
                                )
                        ]
                    });
                } catch {}
                resolve({ status: 'timeout' });
            }, 5000);

            pending.set(msg.id, { resolve, timeout });
        });

        res.json(result);
    } catch (err) {
        console.error('Auth error:', err);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', bot: client.isReady() });
});

client.login(TOKEN);
app.listen(PORT, () => console.log(`HTTP server on port ${PORT}`));
