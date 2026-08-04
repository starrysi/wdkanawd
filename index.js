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

const pending = new Map();

client.once('ready', () => console.log(`Bot ready as ${client.user.tag}`));

function acceptRow() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('accept').setLabel('Accept').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('deny').setLabel('Deny').setStyle(ButtonStyle.Danger)
        );
}

function revokeRow() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('revoke').setLabel('Revoke').setStyle(ButtonStyle.Danger)
        );
}

function disabledRow() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('accept').setLabel('Accept').setStyle(ButtonStyle.Success).setDisabled(true),
            new ButtonBuilder().setCustomId('deny').setLabel('Deny').setStyle(ButtonStyle.Danger).setDisabled(true)
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

    const { hwid, pcName } = parseMsg(interaction.message);
    if (!hwid) {
        await interaction.reply({ content: 'Could not find HWID in message.', ephemeral: true });
        return;
    }

    if (interaction.customId === 'accept') {
        permStatuses[hwid] = 'accepted';
        savePerms();
        await interaction.update({
            content: `**Accepted** - PC: \`${pcName}\` | HWID: \`${hwid}\``,
            components: [revokeRow()]
        });
        await interaction.followUp({ content: `${hwid} is now permanently accepted.`, ephemeral: false });
    } else if (interaction.customId === 'deny') {
        permStatuses[hwid] = 'denied';
        savePerms();
        await interaction.update({
            content: `**Denied** - PC: \`${pcName}\` | HWID: \`${hwid}\``,
            components: [disabledRow()]
        });
        await interaction.followUp({ content: `${hwid} is denied. They will be blocked on next check.`, ephemeral: false });
    } else if (interaction.customId === 'revoke') {
        delete permStatuses[hwid];
        savePerms();
        await interaction.update({
            content: `**Revoked** - PC: \`${pcName}\` | HWID: \`${hwid}\` (no longer accepted)`,
            components: [acceptRow()]
        });
        await interaction.followUp({ content: `${hwid} has been revoked. They will need to re-accept.`, ephemeral: false });
    }
});

app.post('/auth', async (req, res) => {
    try {
        const pcName = req.body.pcName || 'Unknown';
        const hwid = req.body.hwid || 'Unknown';

        if (permStatuses[hwid] === 'accepted') {
            res.json({ status: 'accepted' });
            return;
        }

        if (permStatuses[hwid] === 'denied') {
            res.json({ status: 'denied' });
            return;
        }

        try {
            const channel = await client.channels.fetch(AUTH_CHANNEL_ID);
            await channel.send({
                content: `**Auth Request** - PC: \`${pcName}\` | HWID: \`${hwid}\`\nClick Accept to allow, Deny to block.`,
                components: [acceptRow()]
            });
        } catch (err) {
            console.error('Failed to send auth message:', err);
        }

        const waitForAction = async (msg) => {
            return await new Promise((resolve) => {
                const timeout = setTimeout(async () => {
                    pending.delete(msg.id);
                    try { await msg.edit({ content: msg.content + '\n**Timed Out**', components: [disabledRow()] }); } catch {}
                    resolve({ status: 'timeout' });
                }, 60000);
                pending.set(msg.id, { resolve, timeout, hwid, pcName });
            });
        };

        const channel = await client.channels.fetch(AUTH_CHANNEL_ID);
        const msg = await channel.send({
            content: `**Auth Request** - PC: \`${pcName}\` | HWID: \`${hwid}\`\nClick Accept to allow, Deny to block.`,
            components: [acceptRow()]
        });

        res.json(await waitForAction(msg));
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
    const status = stored === 'denied' ? 'denied' : (stored === 'accepted' ? 'accepted' : 'pending');
    res.json({ status });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', bot: client.isReady(), accepted: Object.keys(permStatuses).filter(k => permStatuses[k] === 'accepted').length, denied: Object.keys(permStatuses).filter(k => permStatuses[k] === 'denied').length });
});

client.login(TOKEN);
app.listen(PORT, () => console.log(`HTTP server on port ${PORT}`));