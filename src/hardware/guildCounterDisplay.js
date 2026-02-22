const { SerialPort } = require('serialport');

/**
 * Streams guild count to Arduino 7-seg display.
 * Sends lines like: COUNT:1234\n
 *
 * Disabled automatically when PORTABLE=true (portable Pico LED mode).
 * The portable Pico runs pico_portable_status.py and is owned by pico-bridge.js.
 */
class GuildCounterDisplay {
  constructor(path = process.env.SEGMENT_PORT || '/dev/ttyACM0', baudRate = 115200) {
    // Skip in portable mode — the ACM port belongs to the LED bridge
    if (process.env.PORTABLE === 'true') {
      this.port = null;
      return;
    }
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
  if (process.env.PORTABLE === 'true') {
    console.log('[7seg] Skipped — portable LED mode active (PORTABLE=true)');
    return;
  }
  const display = new GuildCounterDisplay();
  if (!display.port) return;

  const pushCount = () => display.send(client.guilds.cache.size);

  client.once('ready', pushCount);
  client.on('guildCreate', pushCount);
  client.on('guildDelete', pushCount);

  // Periodic refresh in case an event is missed
  setInterval(pushCount, 5 * 60 * 1000);
};
