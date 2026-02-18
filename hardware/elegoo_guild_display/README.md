# Elegoo Guild Display - 5461AS 7-Segment

Display your Discord bot's server count using an **Arduino Elegoo Mega 2560** connected to a **5461AS 4-digit 7-segment display**!

## Hardware Requirements

- **Arduino Elegoo Mega 2560**
- **5461AS 4-Digit 7-Segment Display** (common-cathode)
- **Raspberry Pi 5** (running Discord bot)
- **USB Cable** (Elegoo to Pi5)
- **Jumper wires** (12 wires for display connections)

## Wiring Diagram

### 5461AS Pin Layout
```
Top pins (left to right):    12  11  10  9   8   7   6
Bottom pins (left to right):  1   2   3   4   5
```

### Standard 5461AS Pinout (Common-Cathode)
- **Pin 1**: E (segment)
- **Pin 2**: D (segment)
- **Pin 3**: DP (decimal point)
- **Pin 4**: C (segment)
- **Pin 5**: G (segment)
- **Pin 6**: D4 (digit 4 common)
- **Pin 7**: B (segment)
- **Pin 8**: D3 (digit 3 common)
- **Pin 9**: D2 (digit 2 common)
- **Pin 10**: F (segment)
- **Pin 11**: A (segment)
- **Pin 12**: D1 (digit 1 common)

### Wiring to Elegoo Mega 2560

Based on your setup (pins 1-6 → 53-43, pins 7-12 → 52-42):

| 5461AS Pin | Function | → | Elegoo Mega Pin |
|------------|----------|---|-----------------|
| 1          | E        | → | 53              |
| 2          | D        | → | 51              |
| 3          | DP       | → | 49              |
| 4          | C        | → | 47              |
| 5          | G        | → | 45              |
| 6          | D4       | → | 43              |
| 7          | B        | → | 42              |
| 8          | D3       | → | 44              |
| 9          | D2       | → | 46              |
| 10         | F        | → | 48              |
| 11         | A        | → | 50              |
| 12         | D1       | → | 52              |

**Note:** No resistors needed! The Arduino's current-limiting via software PWM is sufficient for the display.

## Software Setup

### Step 1: Upload Arduino Code

1. **Install Arduino IDE** (if not already installed):
   ```bash
   # On Ubuntu/Debian
   sudo apt-get install arduino
   
   # Or download from https://www.arduino.cc/en/software
   ```

2. **Open the sketch**:
   - Open Arduino IDE
   - File → Open → `hardware/elegoo_guild_display/elegoo_guild_display.ino`

3. **Configure board**:
   - Tools → Board → Arduino Mega or Mega 2560
   - Tools → Port → /dev/ttyACM0 (or your Elegoo's port)

4. **Upload**:
   - Click the Upload button (→)
   - Wait for "Done uploading"
   - You should see "8888" test pattern on the display!

### Step 2: Install Bridge Service on Pi5

```bash
# SSH to Pi5
ssh ubuntu@192.168.50.2

# Navigate to the project
cd /home/ubuntu/discord-bot/hardware/elegoo_guild_display

# Install Python dependencies
pip3 install pyserial requests --break-system-packages

# Test the bridge
python3 elegoo_bridge.py
```

### Step 3: Create Systemd Service

Create `/etc/systemd/system/elegoo-guild-display.service`:

```bash
sudo tee /etc/systemd/system/elegoo-guild-display.service > /dev/null << 'EOF'
[Unit]
Description=Elegoo Guild Display Bridge
After=network.target discord-bot.service
Wants=discord-bot.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/discord-bot
Environment="ELEGOO_PORT=/dev/ttyACM0"
Environment="DASHBOARD_URL=http://localhost:3001"
ExecStart=/usr/bin/python3 -u /home/ubuntu/discord-bot/hardware/elegoo_guild_display/elegoo_bridge.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable elegoo-guild-display
sudo systemctl start elegoo-guild-display

# Check status
sudo systemctl status elegoo-guild-display
```

## How It Works

```
┌─────────────┐   Status File   ┌──────────────┐   USB Serial   ┌──────────┐   GPIO   ┌──────────┐
│  Discord    │  ─────────────→  │  Pi5 Bridge  │  ────────────→  │  Elegoo  │  ──────→ │  5461AS  │
│  Bot (JS)   │                  │   (Python)   │    115200 baud  │  Mega    │          │ Display  │
└─────────────┘                  └──────────────┘                 └──────────┘          └──────────┘
```

1. Discord bot writes guild count to `/data/bot_status.json`
2. Python bridge reads file and sends `COUNT:XXXX` to Elegoo via serial
3. Arduino receives command and multiplexes the 7-segment display

## Testing

### Test Arduino Code (Serial Monitor)

1. Open Arduino IDE → Tools → Serial Monitor
2. Set baud rate to 115200
3. Send commands:
   - `COUNT:1234` - Display 1234
   - `COUNT:42` - Display 42
   - `PING` - Check connection (responds PONG)
   - `TEST` - Show test pattern (8888)
   - `RESET` - Reset to 0000

### Test the Bridge

```bash
# On Pi5
cd /home/ubuntu/discord-bot/hardware/elegoo_guild_display
python3 elegoo_bridge.py

# You should see:
# [Elegoo Bridge] Connecting to Elegoo at /dev/ttyACM0...
# [Elegoo Bridge] Connected!
# [Elegoo] Guild Display Ready
# [Elegoo Bridge] Guild count: 8
```

## Troubleshooting

### Display shows 8888 (test pattern)
- ✓ Arduino code uploaded successfully
- ✓ Display wired correctly
- ✗ Not receiving data from Pi5
- Check: `sudo systemctl status elegoo-guild-display`

### Display is blank
- Check all 12 wire connections
- Verify Arduino has power (LED lit)
- Open Serial Monitor and send `TEST` command
- Check if pins match the code (Digital 42-53)

### Display shows wrong numbers
- Check segment wiring (pins 1,2,4,5,7,10,11)
- Verify 5461AS is common-cathode (not common-anode)
- Try the TEST command to show 8888

### Bridge can't connect to Elegoo
```
[Elegoo Bridge] Elegoo not found at /dev/ttyACM0
```

**Solutions:**
- Check USB cable connection
- Find the port: `ls /dev/ttyACM* /dev/ttyUSB*`
- Add user to dialout: `sudo usermod -a -G dialout ubuntu`
- Update service file with correct port

### Arduino not responding
- Check baud rate is 115200 in both Arduino code and bridge
- Press reset button on Elegoo
- Re-upload Arduino sketch
- Check Serial Monitor for Arduino boot messages

## Commands Reference

### Service Management
```bash
# Start
sudo systemctl start elegoo-guild-display

# Stop
sudo systemctl stop elegoo-guild-display

# Restart
sudo systemctl restart elegoo-guild-display

# Status
sudo systemctl status elegoo-guild-display

# Logs
journalctl -u elegoo-guild-display -f
```

### Manual Testing
```bash
# Send command directly to Elegoo
echo "COUNT:1234" > /dev/ttyACM0

# Read from Elegoo (see responses)
cat /dev/ttyACM0

# Test with Python bridge
cd /home/ubuntu/discord-bot/hardware/elegoo_guild_display
python3 elegoo_bridge.py
```

## Customization

### Change Update Interval

Edit `elegoo_bridge.py`:
```python
UPDATE_INTERVAL = 10  # Update every 10 seconds instead of 5
```

### Change Serial Port

If Elegoo appears on different port:
```bash
sudo systemctl edit elegoo-guild-display

# Add:
[Service]
Environment="ELEGOO_PORT=/dev/ttyUSB0"
```

### Adjust Display Brightness

Edit Arduino code, change in `multiplexDisplay()`:
```cpp
const unsigned long digitDelay = 2000; // Increase for dimmer, decrease for brighter
```

## Files

- **elegoo_guild_display.ino** - Arduino sketch for Elegoo Mega
- **elegoo_bridge.py** - Python bridge for Pi5
- **README.md** - This file

## Advantages of Using Elegoo

✅ **No resistors needed** - Arduino handles current limiting  
✅ **Easy to program** - Arduino IDE, familiar to many  
✅ **Multiplexing handled** - Arduino does all the timing  
✅ **More pins available** - Can expand to multiple displays  
✅ **USB powered** - No external power supply needed  
✅ **Serial debugging** - Easy to troubleshoot via Serial Monitor

---

**Made with ❤️ for DarkLock Discord Bot**
