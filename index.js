const { Client, GatewayIntentBits, ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const express = require('express');
const fs = require('fs');

const TOKEN = process.env.DISCORD_TOKEN;
const AUTH_CHANNEL_ID = process.env.AUTH_CHANNEL_ID || '1531095882983014572';
const VERIFY_CHANNEL_ID = process.env.VERIFY_CHANNEL_ID || '1532186584353345667';
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

const client = new Client({ intents: [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const app = express();
app.use(express.json());

const pending = new Map();

client.once('ready', () => console.log(`Bot ready as ${client.user.tag}`));

function disabledRow() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('verify').setLabel('Verify').setStyle(ButtonStyle.Success).setDisabled(true),
            new ButtonBuilder().setCustomId('cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger).setDisabled(true)
        );
}

function actionRow() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('verify').setLabel('Verify').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('perm_verify').setLabel('Perm Verify').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('perm_cancel').setLabel('Perm Cancel').setStyle(ButtonStyle.Danger)
        );
}

function removeAllRow() {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder().setCustomId('remove_all').setLabel('Remove All').setStyle(ButtonStyle.Danger)
        );
}

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'remove_all') {
        if (interaction.channelId !== AUTH_CHANNEL_ID) return;
        const count = Object.keys(permStatuses).length;
        permStatuses = {};
        savePerms();
        await interaction.reply({ content: `**Removed all (${count}) permanent statuses.**`, ephemeral: false });
        return;
    }

    if (interaction.channelId !== AUTH_CHANNEL_ID) return;

    const msgId = interaction.message.id;
    const resolver = pending.get(msgId);

    if (!resolver) {
        if (interaction.customId === 'cancel') {
            await interaction.reply({ content: 'Already resolved.', ephemeral: true });
        } else if (interaction.customId === 'verify' || interaction.customId === 'perm_verify') {
            await interaction.reply({ content: 'Expired.', ephemeral: true });
        }
        return;
    }

    clearTimeout(resolver.timeout);
    pending.delete(msgId);

    if (interaction.customId === 'cancel_perm') {
        delete permStatuses[resolver.hwid];
        savePerms();
        await interaction.update({ content: `Perm cancelled for **${resolver.hwid}**.`, components: [] });
        const msg = await interaction.channel.send({
            content: `**(HWID: ${resolver.hwid}) (${resolver.pcName}) is trying to open the mod auth request**`,
            components: [actionRow(), removeAllRow()]
        });
        const newRes = await new Promise((resolve) => {
            pending.set(msg.id, { resolve, hwid: resolver.hwid, pcName: resolver.pcName });
        });
        resolver.resolve(newRes);
        return;
    }

    let status, actionLabel;
    if (interaction.customId === 'verify') {
        status = 'accepted';
        actionLabel = 'Verified';
        try {
            const verifyChannel = await client.channels.fetch(VERIFY_CHANNEL_ID);
            if (verifyChannel) {
                await verifyChannel.send(`**Player Verified** - HWID: \`${resolver.hwid}\` | PC: \`${resolver.pcName}\``);
            }
        } catch (err) {
            console.error('Failed to send verify message:', err);
        }
    } else if (interaction.customId === 'perm_verify') {
        permStatuses[resolver.hwid] = 'accepted';
        savePerms();
        status = 'accepted';
        actionLabel = 'Verified (Permanent)';
        try {
            const verifyChannel = await client.channels.fetch(VERIFY_CHANNEL_ID);
            if (verifyChannel) {
                await verifyChannel.send(`**Player Verified (Permanent)** - HWID: \`${resolver.hwid}\` | PC: \`${resolver.pcName}\``);
            }
        } catch (err) {
            console.error('Failed to send verify message:', err);
        }
    } else if (interaction.customId === 'cancel') {
        status = 'denied';
        actionLabel = 'Canceled';
    } else if (interaction.customId === 'perm_cancel') {
        permStatuses[resolver.hwid] = 'denied';
        savePerms();
        status = 'denied';
        actionLabel = 'Canceled (Permanent)';
    } else {
        await interaction.reply({ content: 'Unknown.', ephemeral: true });
        return;
    }

    await interaction.update({ content: `**(HWID: ${resolver.hwid}) (${resolver.pcName}) - ${actionLabel}**`, components: [disabledRow()] });
    resolver.resolve({ status });
});

app.post('/auth', async (req, res) => {
    try {
        const pcName = req.body.pcName || 'Unknown';
        const hwid = req.body.hwid || 'Unknown';
        const channel = await client.channels.fetch(AUTH_CHANNEL_ID);

        const waitForAction = async (msg) => {
            return await new Promise((resolve) => {
                const timeout = setTimeout(async () => {
                    pending.delete(msg.id);
                    try { await msg.edit({ content: `**(HWID: ${hwid}) (${pcName}) - Timed Out**`, components: [disabledRow()] }); } catch {}
                    resolve({ status: 'timeout' });
                }, 40000);
                pending.set(msg.id, { resolve, timeout, hwid, pcName });
            });
        };

        if (permStatuses[hwid] === 'accepted') {
            const msg = await channel.send({
                content: `**(HWID: ${hwid}) (${pcName}) is trying to open - PERM VERIFIED**\nClick Cancel Perm to remove it.`,
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('cancel_perm').setLabel('Cancel Perm').setStyle(ButtonStyle.Secondary)
                ), removeAllRow()]
            });
            return res.json(await waitForAction(msg));
        }

        if (permStatuses[hwid] === 'denied') {
            const msg = await channel.send({
                content: `**(HWID: ${hwid}) (${pcName}) is trying to open - PERM CANCELED**\nClick Cancel Perm to remove it.`,
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('cancel_perm').setLabel('Cancel Perm').setStyle(ButtonStyle.Secondary)
                ), removeAllRow()]
            });
            return res.json(await waitForAction(msg));
        }

        const msg = await channel.send({
            content: `**(HWID: ${hwid}) (${pcName}) is trying to open the mod auth request**`,
            components: [actionRow(), removeAllRow()]
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
    let isPending = false;
    for (const entry of pending.values()) {
        if (entry.hwid === hwid) { isPending = true; break; }
    }
    const status = stored ? stored : (isPending ? 'pending' : 'unknown');
    res.json({ status });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', bot: client.isReady(), perms: Object.keys(permStatuses).length });
});

client.login(TOKEN);
app.listen(PORT, () => console.log(`HTTP server on port ${PORT}`));
