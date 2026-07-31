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

function verifyRow() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('verify').setLabel('Verify').setStyle(ButtonStyle.Success)
        );
}

function parseMsg(msg) {
    const hwidMatch = msg.content.match(/HWID:\s*`([^`]+)`/);
    const pcNameMatch = msg.content.match(/PC:\s*`([^`]+)`/);
    return {
        hwid: hwidMatch ? hwidMatch[1] : null,
        pcName: pcNameMatch ? pcNameMatch[1] : 'Unknown'
    };
}

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.channelId !== AUTH_CHANNEL_ID) return;
    if (interaction.customId !== 'cancel' && interaction.customId !== 'verify') return;

    const { hwid, pcName } = parseMsg(interaction.message);
    if (!hwid) {
        await interaction.reply({ content: 'Could not find HWID in message.', ephemeral: true });
        return;
    }

    if (interaction.customId === 'cancel') {
        permStatuses[hwid] = 'denied';
        savePerms();
        await interaction.update({
            content: `**Canceled** - PC: \`${pcName}\` | HWID: \`${hwid}\``,
            components: [verifyRow()]
        });
        await interaction.followUp({ content: `Game will close for **${hwid}**. Click Verify to let them back in.`, ephemeral: false });
    } else {
        delete permStatuses[hwid];
        savePerms();
        await interaction.update({
            content: `**Verified** - PC: \`${pcName}\` | HWID: \`${hwid}\``,
            components: [cancelRow()]
        });
        await interaction.followUp({ content: `**${hwid}** can join again.`, ephemeral: false });
    }
});

app.post('/auth', async (req, res) => {
    try {
        const pcName = req.body.pcName || 'Unknown';
        const hwid = req.body.hwid || 'Unknown';

        try {
            const channel = await client.channels.fetch(AUTH_CHANNEL_ID);
            const denied = permStatuses[hwid] === 'denied';
            await channel.send({
                content: denied
                    ? `**Blocked** - PC: \`${pcName}\` | HWID: \`${hwid}\``
                    : `**Logged in** - PC: \`${pcName}\` | HWID: \`${hwid}\``,
                components: denied ? [verifyRow()] : [cancelRow()]
            });
        } catch (err) {
            console.error('Failed to send auth message:', err);
        }

        if (permStatuses[hwid] === 'denied') {
            res.json({ status: 'denied' });
        } else {
            res.json({ status: 'accepted' });
        }
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
