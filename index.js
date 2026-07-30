const { Client, GatewayIntentBits, ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const express = require('express');
const fs = require('fs');

const TOKEN = process.env.DISCORD_TOKEN;
const AUTH_CHANNEL_ID = process.env.AUTH_CHANNEL_ID || '1531095882983014572';
const PORT = process.env.PORT || 3000;
const STORAGE = process.env.STORAGE || '/data/perm-statuses.json';

if (!TOKEN) {
    console.error('Missing DISCORD_TOKEN env var');
    process.exit(1);
}

let permStatuses = {};
if (fs.existsSync(STORAGE)) {
    try { permStatuses = JSON.parse(fs.readFileSync(STORAGE, 'utf8')); } catch {}
}

function savePerms() {
    try { fs.writeFileSync(STORAGE, JSON.stringify(permStatuses, null, 2)); } catch {}
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const app = express();
app.use(express.json());

client.once('ready', () => console.log(`Bot ready as ${client.user.tag}`));

function cancelRow() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger)
        );
}

function disabledCancelRow() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger).setDisabled(true)
        );
}

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.customId !== 'cancel' || interaction.channelId !== AUTH_CHANNEL_ID) return;

    const msg = interaction.message;
    const match = msg.content.match(/HWID:\s*`([^`]+)`/);
    if (!match) {
        await interaction.reply({ content: 'Could not find HWID in message.', ephemeral: true });
        return;
    }

    const hwid = match[1];
    permStatuses[hwid] = 'denied';
    savePerms();

    await interaction.update({ content: `**Canceled** - ${msg.content}`, components: [disabledCancelRow()] });
    await interaction.followUp({ content: `Game will close for **${hwid}** on next poll.`, ephemeral: false });
});

app.post('/auth', async (req, res) => {
    try {
        const pcName = req.body.pcName || 'Unknown';
        const hwid = req.body.hwid || 'Unknown';

        try {
            const channel = await client.channels.fetch(AUTH_CHANNEL_ID);
            await channel.send({
                content: `**Logged in** - PC: \`${pcName}\` | HWID: \`${hwid}\``,
                components: [cancelRow()]
            });
        } catch (err) {
            console.error('Failed to send auth message:', err);
        }

        res.json({ status: 'accepted' });
    } catch (err) {
        console.error('Auth error:', err);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.post('/alert', async (req, res) => {
    try {
        const pcName = req.body.pcName || 'Unknown';
        const hwid = req.body.hwid || 'Unknown';
        const message = req.body.message || 'Unknown alert';
        const channel = await client.channels.fetch(AUTH_CHANNEL_ID);

        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle(':warning: Guard Alert')
            .addFields(
                { name: 'PC', value: pcName, inline: true },
                { name: 'HWID', value: hwid, inline: true },
                { name: 'Message', value: message }
            )
            .setTimestamp();

        await channel.send({ embeds: [embed] });
        res.json({ status: 'ok' });
    } catch (err) {
        console.error('Alert error:', err);
        res.status(500).json({ status: 'error' });
    }
});

app.get('/check/:hwid', (req, res) => {
    const hwid = req.params.hwid;
    const stored = permStatuses[hwid];
    const status = stored === 'denied' ? 'denied' : 'accepted';
    res.json({ status });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', bot: client.isReady(), denials: Object.keys(permStatuses).length });
});

client.login(TOKEN);
app.listen(PORT, () => console.log(`HTTP server on port ${PORT}`));
