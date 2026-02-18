const { SerialPort } = require('serialport');

/**
 * Streams guild count to Arduino 7-seg display.
 * Sends lines like: COUNT:1234\n
 */
class GuildCounterDisplay {
  constructor(path = process.env.SEGMENT_PORT || '/dev/ttyACM0', baudRate = 115200) {
    this.port = null;
    try {
      this.port = new SerialPort({ path, baudRate });
      this.port.on('error', (err) => console.warn('[7seg] serial error:', err.message));
      console.log(`[7seg] Connected to ${path} @ ${baudRate}`);
    } catch (err) {
      console.warn('[7seg] display disabled:', err.message);
    }
  }

  send(count) {
    if (!this.port) return;
    this.port.write(`COUNT:${count}\n`);
  }
}

module.exports = function wireGuildCounterDisplay(client) {
  const display = new GuildCounterDisplay();
  if (!display.port) return;

  const pushCount = () => display.send(client.guilds.cache.size);

  client.once('ready', pushCount);
  client.on('guildCreate', pushCount);
  client.on('guildDelete', pushCount);

  // Periodic refresh in case an event is missed
  setInterval(pushCount, 5 * 60 * 1000);
};
