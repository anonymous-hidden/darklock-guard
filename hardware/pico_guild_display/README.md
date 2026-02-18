# Pico Guild Display - 5461AS 7-Segment

Display your Discord bot's server count on a 4-digit 7-segment display using a Raspberry Pi Pico!

## Hardware Requirements

- **Raspberry Pi Pico** (or Pico W)
- **5461AS 4-Digit 7-Segment Display** (common-cathode)
- **8x 220Ω resistors** (for segments A-G and DP)
- **USB Cable** (to connect Pico to Pi5)
- **Breadboard and jumper wires**

## Wiring Diagram

### 5461AS to Raspberry Pi Pico

The 5461AS has 12 pins. View it from the front with the decimal points at the bottom.

```
Pin Layout (front view):
┌─────────────────┐
│  ┌───┐  ┌───┐  │
│  │ █ │  │ █ │  │  7-Segment Display
│  └───┘  └───┘  │
│  ┌───┐  ┌───┐  │
│  │ █ │  │ █ │  │
│  └───┘  └───┘  │
│  • • • •  • • •│  ← Decimal points
└─────────────────┘
 12 11 10 9  8 7 6  ← Pin numbers (top)
 1  2  3  4  5       ← Pin numbers (bottom)
```

### Segment Connections (through 220Ω resistors)

| Segment | 5461AS Pin | → Resistor → | Pico GPIO |
|---------|------------|--------------|-----------|
| A       | 11         | 220Ω         | GP2       |
| B       | 7          | 220Ω         | GP3       |
| C       | 4          | 220Ω         | GP4       |
| D       | 2          | 220Ω         | GP5       |
| E       | 1          | 220Ω         | GP6       |
| F       | 10         | 220Ω         | GP7       |
| G       | 5          | 220Ω         | GP8       |
| DP      | 3          | 220Ω         | GP9       |

### Digit Select Connections (direct, NO resistor)

| Digit | 5461AS Pin | → Direct → | Pico GPIO |
|-------|------------|------------|-----------|
| DIG1  | 12         | Direct     | GP10      |
| DIG2  | 9          | Direct     | GP11      |
| DIG3  | 8          | Direct     | GP12      |
| DIG4  | 6          | Direct     | GP13      |

### Power

- Connect Pico **VSYS** or **VBUS** pin to breadboard power rail (5V from USB)
- Connect Pico **GND** to breadboard ground rail
- **Do NOT connect 5V directly to the display segments** - they go through the Pico GPIOs only!

## Software Setup

### Step 1: Install MicroPython on Pico

1. Download MicroPython firmware from https://micropython.org/download/rp2-pico/
2. Hold the BOOTSEL button on your Pico
3. Connect Pico to your computer via USB (while holding BOOTSEL)
4. Drag and drop the `.uf2` file to the RPI-RP2 drive that appears
5. The Pico will reboot with MicroPython installed

### Step 2: Upload Display Code to Pico

**Option A: Using Thonny (Easiest)**
```bash
sudo apt-get install thonny
```
1. Open Thonny IDE
2. Select "MicroPython (Raspberry Pi Pico)" from bottom-right
3. Open `main.py` from this directory
4. Click "File → Save As" → "Raspberry Pi Pico" → save as `main.py`
5. The code will run automatically on boot!

**Option B: Using ampy (Command Line)**
```bash
pip3 install adafruit-ampy
ampy --port /dev/ttyACM0 put main.py /main.py
```

**Option C: Using rshell**
```bash
pip3 install rshell
rshell -p /dev/ttyACM0
# In rshell:
cp main.py /pyboard/
```

### Step 3: Install Bridge Service on Pi5

Run the installation script:
```bash
cd hardware/pico_guild_display
./install.sh
```

This will:
- Install Python dependencies (pyserial, requests)
- Create systemd service
- Configure permissions

### Step 4: Start the Service

```bash
sudo systemctl start pico-guild-display
sudo systemctl status pico-guild-display
```

View logs:
```bash
journalctl -u pico-guild-display -f
```

## How It Works

```
┌─────────────┐    USB Serial     ┌──────────────┐    GPIO    ┌──────────┐
│  Discord    │  ──────────→      │  Pi5 Bridge  │  ──────→   │   Pico   │
│  Bot (JS)   │  status file      │   (Python)   │  115200    │ (MicroPy)│
└─────────────┘                   └──────────────┘            └──────────┘
                                                                     │
                                                                     ↓
                                                               ┌──────────┐
                                                               │  5461AS  │
                                                               │ 7-Seɡment│
                                                               └──────────┘
```

1. **Bot** writes guild count to `/data/bot_status.json` every 5 seconds
2. **Bridge Script** reads the file and sends `COUNT:XXXX` to Pico via serial
3. **Pico** multiplexes the 7-segment display to show the count

## Testing

### Test the Display (without bot)

Connect to Pico serial and send commands:
```bash
screen /dev/ttyACM0 115200
```

Commands:
- `COUNT:1234` - Display 1234
- `COUNT:42` - Display 42 (leading zeros)
- `PING` - Check if Pico is responding (replies PONG)
- `RESET` - Reset display to 0000

Press `Ctrl+A` then `K` to exit screen.

### Test the Bridge

```bash
cd hardware/pico_guild_display
python3 pico_bridge.py
```

### Check Bot Status

```bash
cat data/bot_status.json
```

## Troubleshooting

### Display shows 8888
This is the test pattern on boot. It means:
- ✓ Pico is working
- ✓ Display is wired correctly
- ✗ Not receiving data from bridge

Check: `sudo systemctl status pico-guild-display`

### Display is blank
- Check all wiring connections
- Verify resistors are in place for segments
- Check Pico is powered (LED should be on)
- Connect to serial and send `COUNT:8888` to test

### Display shows incorrect numbers
- Check segment wiring (A-G pins might be swapped)
- Verify you're using common-cathode (5461AS)
- Check resistor values (should be 220Ω)

### Bridge can't connect to Pico
```
[Guild Display Bridge] Pico not found at /dev/ttyACM0
```

Solutions:
- Replug Pico USB cable
- Check `ls /dev/ttyACM*` or `ls /dev/ttyUSB*`
- Add user to dialout group: `sudo usermod -a -G dialout $USER`
- Log out and back in after adding to dialout group

### Bot status file not updating
- Check bot is running: `systemctl status discord-bot`
- Verify bot started after status writer was added
- Check file exists: `ls -la data/bot_status.json`

### Service won't start
```bash
# Check detailed errors
journalctl -u pico-guild-display -n 50

# Check permissions
ls -la /dev/ttyACM0
groups $USER
```

## Customization

### Change Update Interval

Edit `pico_bridge.py`:
```python
UPDATE_INTERVAL = 10  # Update every 10 seconds instead of 5
```

### Different Serial Port

If Pico appears on different port:
```bash
sudo systemctl edit pico-guild-display
```
Add:
```ini
[Service]
Environment="PICO_PORT=/dev/ttyUSB0"
```

### Brightness Adjustment

Edit `main.py` on Pico:
```python
time.sleep_us(2000)  # Change to 1000 for dimmer, 3000 for brighter
```

## Uninstall

```bash
sudo systemctl stop pico-guild-display
sudo systemctl disable pico-guild-display
sudo rm /etc/systemd/system/pico-guild-display.service
sudo systemctl daemon-reload
```

## Files

- **main.py** - MicroPython code for Pico (controls display)
- **pico_bridge.py** - Python bridge for Pi5 (reads bot data, sends to Pico)
- **install.sh** - Installation script
- **README.md** - This file

## Support

If you have issues:
1. Check the troubleshooting section above
2. View logs: `journalctl -u pico-guild-display -f`
3. Test each component separately (display → pico → bridge → bot)

---

**Made with ❤️ for DarkLock Discord Bot**
