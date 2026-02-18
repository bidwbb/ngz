# NGZ — SPORTident Card Reader

A desktop app for reading SPORTident cards at orienteering events. Shows a full-screen happy/sad face result display with course validation — great for school and youth events.

## Quick Start

### 1. Download

Go to the [Releases](https://github.com/bidwbb/ngz/releases) page and download the right file for your computer:

- **Windows**: `NGZ Setup 0.1.0.exe` (installer) or `NGZ 0.1.0.exe` (portable, no install needed)
- **macOS**: `NGZ-0.1.0.dmg`
- **Linux**: `NGZ-0.1.0.AppImage`

### 2. Install the USB Driver

Your computer needs the **Silicon Labs CP210x driver** to communicate with the SPORTident station.

- **Windows**: Download from [Silicon Labs](https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers). Windows 10/11 may install it automatically when you plug in the station.
- **macOS**: Download from [Silicon Labs](https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers).
- **Linux**: Usually built in. If the station isn't detected, run `sudo usermod -a -G dialout $USER` and log out/in.

### 3. Run

1. Plug in your SPORTident station via USB
2. Launch NGZ
3. Select the COM port (auto-detected SPORTident stations are marked with ★)
4. Select an event (Animal-O is built in, or create your own)
5. Click **Connect** — the station beeps twice when ready
6. Insert SI cards to read them!

## How It Works

### Reading Cards

Insert an SI card into the station and a full-screen result appears:

- **Green happy face** + ascending chime = all controls correct
- **Red sad face** + descending buzz = missing or wrong controls

Shows the course name, race time, card number, and a per-control breakdown. Click to pause the display, click again to dismiss (or it auto-dismisses after 10 seconds).

### Events and Courses

An event is a set of courses. On the setup screen:

- The **Animal-O** event is built in with 10 courses (Lion, Bee, Crab, etc.)
- Click **+ New Event** to create your own:
  - **Paste Controls** — type courses like `Lion: 31, 33, 36, 38, 39` (one per line)
  - **IOF XML** — import a course file from Purple Pen, OCAD, or Condes

The app auto-detects which course a card matches based on the punches.

### Course Validation

- **Inline courses**: Controls must appear in the correct order. Extra controls are allowed (the app only checks that the required sequence is present).
- **Score-O courses**: Controls can be in any order.
- Only punches between the card's start and finish times are considered, so you don't need to clear cards between runs.

### Log Screen

- **Read History**: Table of all cards read with OK/PM status
- **Protocol Log**: Raw SI protocol messages for debugging

## Station Configuration

Your SPORTident station must be configured with:

1. **Extended protocol** → ON
2. **Handshake mode** → ON (autosend → OFF)
3. **Operating mode** → Readout

Configure using **SI-Config** or **SportIdent Config+**.

## Supported SI Cards

SiCard 5, 6, 6*, 8, 9, 10, 11, SIAC (including 192-punch mode)

## Troubleshooting

### "No SPORTident station found"
- Check USB connection and make sure the CP210x driver is installed
- Try unplugging and replugging the USB cable
- Linux: `sudo usermod -a -G dialout $USER`

### "Master station did not answer"
- Verify station is in readout mode with extended protocol
- Ensure no other program (SI-Config, etc.) is using the serial port

### Windows SmartScreen warning
The app is not code-signed, so Windows may show a blue warning the first time you run it. Click **More info** → **Run anyway**. This only happens once.

---

## For Developers

### Prerequisites
- **Node.js** 18+ (download from https://nodejs.org)
- **SPORTident station** connected via USB

### Install and Run

```bash
# Install dependencies
npm install
npm install serialport
npm install --save-dev @types/serialport
npm run renderer:install

# Development mode (hot-reload)
npm run dev

# Build and run production
npm start
```

### CLI (no GUI)

```bash
npx ts-node src/cli.ts              # Auto-detect SI station
npx ts-node src/cli.ts COM3         # Specify port
npx ts-node src/cli.ts --list       # List available ports
```

### Building Installers

```bash
npm run dist:win     # Windows .exe
npm run dist:mac     # macOS .dmg
npm run dist:linux   # Linux .AppImage
```

Installers are output to the `release/` folder. The GitHub Actions workflow builds all three platforms automatically when you push a version tag (`git tag v0.2.0 && git push origin v0.2.0`).

### Project Structure

```
ngz/
├── src/                        # Core library (no Electron dependency)
│   ├── si-protocol/            # SI protocol implementation (from GecoSI)
│   │   ├── crc.ts              # CRC calculator
│   │   ├── SiMessage.ts        # Frame structure and constants
│   │   ├── SiDataFrame.ts      # Card data parsers
│   │   ├── SiDriver.ts         # Protocol state machine
│   │   ├── SiSerial.ts         # Serial port adapter
│   │   └── __tests__/          # Unit tests with real card data
│   ├── course-validator/       # Course validation algorithms
│   │   └── validator.ts        # Inline (Levenshtein) + Score-O
│   └── cli.ts                  # CLI card reader tool
├── electron/
│   ├── main.ts                 # Electron main process
│   ├── preload.ts              # IPC bridge to renderer
│   └── renderer/               # React UI (Vite + React)
│       └── src/
│           ├── App.tsx          # Main app component
│           └── App.css          # Styles
├── .github/workflows/
│   └── build.yml               # CI/CD: builds all platforms on tag push
└── package.json
```

## Credits

- SI protocol ported from [GecoSI](https://github.com/sdenier/GecoSI) by Simon Denier (MIT)
- CRC calculator from SPORTident (CC BY 3.0)
- Course validation inspired by [EasyGec](https://github.com/sdenier/Geco) by Thierry Porret