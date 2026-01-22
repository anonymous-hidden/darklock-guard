const { EmbedBuilder } = require('discord.js');
const emailUtil = require('./email');

async function notifyIncident(bot, guildId, type, details = {}) {
  try {
    const cfg = await bot.database.getGuildConfig(guildId);
    const guild = bot.client.guilds.cache.get(guildId);
    if (!guild) return false;

    const modLogId = cfg?.mod_log_channel || cfg?.log_channel_id || cfg?.logs_channel_id;
    const staffRoleId = cfg?.admin_role_id || cfg?.mod_role_id;

    const embed = new EmbedBuilder()
      .setTitle(`🚨 Incident: ${type}`)
      .setDescription(details.message || 'An incident requires attention.')
      .addFields(
        { name: 'Guild', value: guild.name, inline: true },
        { name: 'Type', value: String(type), inline: true }
      )
      .setColor('#ff3b3b')
      .setTimestamp();

    // Post to mod-log
    try {
      const channel = modLogId ? guild.channels.cache.get(modLogId) : guild.systemChannel;
      if (channel && channel.isTextBased?.()) await channel.send({ embeds: [embed] });
    } catch (_) {}

    // Ping staff role
    try {
      if (staffRoleId) {
        const channel = modLogId ? guild.channels.cache.get(modLogId) : guild.systemChannel;
        if (channel && channel.isTextBased?.()) await channel.send(`<@&${staffRoleId}>`);
      }
    } catch (_) {}

    // Email owner (best-effort)
    try {
      const owner = await guild.fetchOwner();
      const to = cfg?.owner_email || null;
      if (to) {
        await emailUtil.sendEmail({
          to,
          subject: `Guardian Pro Alert: ${type}`,
          text: `Guild: ${guild.name}\nType: ${type}\nDetails: ${JSON.stringify(details)}`
        });
      }
    } catch (_) {}

    return true;
  } catch (e) {
    bot.logger?.warn && bot.logger.warn('[Alerts] notifyIncident error', e.message || e);
    return false;
  }
}

module.exports = { notifyIncident };
