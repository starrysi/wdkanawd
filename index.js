const { Client, GatewayIntentBits, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const express = require('express');
const fs = require('fs');

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.CHANNEL_ID || '1531095882983014572';
const PORT = process.env.PORT || 3000;
const STORAGE = '/data/perm-statuses.json';

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

const client = new Client({ intents: [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const app = express();
app.use(express.json());

const pending = new Map();

client.once('ready', () => console.log(`Bot ready as ${client.user.tag}`));

function disabledRow(acceptId, acceptLabel, revokeId, revokeLabel) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId(acceptId).setLabel(acceptLabel).setStyle(ButtonStyle.Success).setDisabled(true),
            new ButtonBuilder().setCustomId(revokeId).setLabel(revokeLabel).setStyle(ButtonStyle.Danger).setDisabled(true)
        );
}

function fourButtonRow() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('accept').setLabel('Accept').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('perm_accept').setLabel('Perm Accept').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('revoke').setLabel('Revoke').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('perm_revoke').setLabel('Perm Revoke').setStyle(ButtonStyle.Danger)
        );
}

function singleButtonRow(id, label, style) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style)
        );
}

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.channelId !== CHANNEL_ID) return;

    const msgId = interaction.message.id;
    const resolver = pending.get(msgId);
    if (!resolver) {
        await interaction.reply({ content: 'Expired.', ephemeral: true });
        return;
    }

    clearTimeout(resolver.timeout);
    pending.delete(msgId);

    if (interaction.customId === 'cancel_perm') {
        delete permStatuses[resolver.hwid];
        savePerms();
        await interaction.update({
            content: `Perm cancelled for **${resolver.hwid}**. Re-prompting...`,
            components: []
        });
        // Re-prompt with 4 buttons
        const msg = await interaction.channel.send({
            content: `**(HWID: ${resolver.hwid}) (${resolver.pcName}) is trying to open the mod auth request**`,
            components: [fourButtonRow()]
        });
        const newRes = await new Promise((resolve) => {
            const t = setTimeout(async () => {
                pending.delete(msg.id);
                try {
                    await msg.edit({ content: '**No Perm Accept**', components: [disabledRow('accept', 'Accept', 'perm_revoke', 'Perm Revoke')] });
                } catch {}
                resolve({ status: 'timeout' });
            }, 5000);
            pending.set(msg.id, { resolve, timeout: t, hwid: resolver.hwid, pcName: resolver.pcName });
        });
        resolver.resolve(newRes);
        return;
    }

    let status, content;
    if (interaction.customId === 'accept') {
        content = '**Perm Accept**';
        status = 'accepted';
    } else if (interaction.customId === 'perm_accept') {
        permStatuses[resolver.hwid] = 'accepted';
        savePerms();
        content = '**Perm Accept (Permanent)**';
        status = 'accepted';
    } else if (interaction.customId === 'revoke') {
        content = '**Perm Cancel**';
        status = 'denied';
    } else if (interaction.customId === 'perm_revoke') {
        permStatuses[resolver.hwid] = 'denied';
        savePerms();
        content = '**Perm Cancel (Permanent)**';
        status = 'denied';
    } else {
        await interaction.reply({ content: 'Unknown button.', ephemeral: true });
        return;
    }

    await interaction.update({ content, components: [disabledRow('accept', 'Accept', 'perm_revoke', 'Perm Revoke')] });
    resolver.resolve({ status });
});

app.post('/auth', async (req, res) => {
    try {
        const pcName = req.body.pcName || 'Unknown';
        const hwid = req.body.hwid || 'Unknown';
        const channel = await client.channels.fetch(CHANNEL_ID);

        if (permStatuses[hwid] === 'accepted') {
            const msg = await channel.send({
                content: `**(HWID: ${hwid}) (${pcName}) is trying to open - PERM ACCEPTED**\nClick Cancel Perm to remove it.`,
                components: [singleButtonRow('cancel_perm', 'Cancel Perm', ButtonStyle.Secondary)]
            });
            const result = await new Promise((resolve) => {
                const t = setTimeout(async () => {
                    pending.delete(msg.id);
                    try { await msg.edit({ content: '**Perm Accept** (auto)', components: [disabledRow('accept', 'Accept', 'perm_revoke', 'Perm Revoke')] }); } catch {}
                    resolve({ status: 'accepted' });
                }, 5000);
                pending.set(msg.id, { resolve, timeout: t, hwid, pcName });
            });
            return res.json(result);
        }

        if (permStatuses[hwid] === 'denied') {
            const msg = await channel.send({
                content: `**(HWID: ${hwid}) (${pcName}) is trying to open - PERM REVOKED**\nClick Cancel Perm to remove it.`,
                components: [singleButtonRow('cancel_perm', 'Cancel Perm', ButtonStyle.Secondary)]
            });
            const result = await new Promise((resolve) => {
                const t = setTimeout(async () => {
                    pending.delete(msg.id);
                    try { await msg.edit({ content: '**Perm Cancel** (auto)', components: [disabledRow('accept', 'Accept', 'perm_revoke', 'Perm Revoke')] }); } catch {}
                    resolve({ status: 'denied' });
                }, 5000);
                pending.set(msg.id, { resolve, timeout: t, hwid, pcName });
            });
            return res.json(result);
        }

        const msg = await channel.send({
            content: `**(HWID: ${hwid}) (${pcName}) is trying to open the mod auth request**`,
            components: [fourButtonRow()]
        });

        const result = await new Promise((resolve) => {
            const timeout = setTimeout(async () => {
                pending.delete(msg.id);
                try {
                    await msg.edit({ content: '**No Perm Accept**', components: [disabledRow('accept', 'Accept', 'perm_revoke', 'Perm Revoke')] });
                } catch {}
                resolve({ status: 'timeout' });
            }, 5000);
            pending.set(msg.id, { resolve, timeout, hwid, pcName });
        });

        res.json(result);
    } catch (err) {
        console.error('Auth error:', err);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', bot: client.isReady(), perms: Object.keys(permStatuses).length });
});

client.login(TOKEN);
app.listen(PORT, () => console.log(`HTTP server on port ${PORT}`));
