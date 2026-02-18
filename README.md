# NGZ — SPORTident Card Reader

A TypeScript/Electron app for reading SPORTident cards at orienteering events. Shows a full-screen happy/sad face result display with course validation.

## Quick Start

### Prerequisites
- **Node.js** 18+ (download from https://nodejs.org)
- **SPORTident station** (BSF8, BS11, etc.) connected via USB
- Station must be in **readout mode** with **extended protocol** and **handshake mode** enabled

### Install

```bash
# Install root dependencies (SI protocol, Electron, etc.)
npm install
npm install serialport
npm install --save-dev @types/serialport

# Install renderer dependencies (React, Vite)
npm run renderer:install
```

### Run the Desktop App

```bash
# Development mode (hot-reload on UI changes)
npm run dev

# Or build and run production
npm start
```

### Run the CLI (no GUI)

```bash
npx ts-node src/cli.ts              # Auto-detect SI station
npx ts-node src/cli.ts COM3         # Specify port
npx ts-node src/cli.ts --list       # List available ports
```

## How It Works

### Setup Screen
1. Select your serial port (auto-detects SPORTident stations)
2. Optionally define courses with control code sequences
3. Click **Connect** — the station beeps twice when ready

### Reading Cards
- Insert an SI card into the station
- Full-screen result appears:
  - **Green happy face** + ascending chime = all controls OK
  - **Red sad face** + descending buzz = missing controls (PM)
- Shows race time, card number, course name, and per-control breakdown
- Click to pause, click again to dismiss (or auto-dismiss after 10s)

### Course Definition
- Type control codes separated by commas: `31, 32, 33, 34, 35`
- Choose **Inline** (order matters) or **Score-O** (any order)
- Multiple courses supported — auto-detects which course the card matches
- Courses are optional — without them, the reader just displays card data

### Log Screen
- **Read History**: Table of all cards read with status
- **Protocol Log**: Raw SI protocol messages for debugging

## Station Configuration

Your SPORTident station must be configured with:

1. **Extended protocol** → ON
2. **Handshake mode** → ON (autosend → OFF)
3. **Operating mode** → Readout

Configure using **SI-Config** or **SportIdent Config+**.

## Supported SI Cards

SiCard 5, 6, 6*, 8, 9, 10, 11, SIAC (including 192-punch mode)

## Project Structure

```
ngz/
├── src/                        # Core library (no Electron dependency)
│   ├── si-protocol/            # SI protocol port (from GecoSI)
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
│   └── renderer/               # React UI
│       └── src/
│           ├── App.tsx          # Main app component
│           └── App.css          # Styles
└── package.json
```

## Troubleshooting

### "No SPORTident station found"
- Check USB connection
- Linux: `sudo usermod -a -G dialout $USER`
- macOS: Install CP210x driver from Silicon Labs

### "Master station did not answer"
- Verify station is in readout mode with extended protocol
- Unplug and replug USB cable
- Ensure no other program is using the serial port

### Electron won't start
- Make sure both `npm install` and `npm run renderer:install` completed
- Try `npm run renderer:build` then `npm run electron:dev` separately

## Credits

- SI protocol ported from [GecoSI](https://github.com/sdenier/GecoSI) by Simon Denier (MIT)
- CRC calculator from SPORTident (CC BY 3.0)
- Course validation inspired by [EasyGecNG](https://github.com/charliemoore00/EasyGecNG)
