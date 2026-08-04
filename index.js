const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
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

app.post('/auth', async (req, res) => {
    try {
        const pcName = req.body.pcName || 'Unknown';
        const hwid = req.body.hwid || 'Unknown';

        permStatuses[hwid] = 'accepted';
        savePerms();

        try {
            const channel = await client.channels.fetch(AUTH_CHANNEL_ID);
            await channel.send({
                content: `**Auto-Accepted** - PC: \`${pcName}\` | HWID: \`${hwid}\``
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
    res.json({ status: 'ok', bot: client.isReady(), accepted: Object.keys(permStatuses).filter(k => permStatuses[k] === 'accepted').length });
});

client.login(TOKEN);
app.listen(PORT, () => console.log(`HTTP server on port ${PORT}`));