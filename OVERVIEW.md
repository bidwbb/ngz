# Navigation Games SI Readout Software — Overview & Plan

_Written 2026-11-19. It covers three programs that do the same job, plus the library two of them build on:_

| Program | Repo | Stack | Authorship | Status |
|---|---|---|---|---|
| **EasyGecNG** | `Navigation-Games/EasyGecNG` (fork of Thierry Porret's EasyGec, which forks Simon Denier's Geco) | Java 8, Swing, Gradle | Hand-written. Original French authors, then Charlie Moore, Quinn Bowers, Oomi Pammit, Ivy Wong, Barb | In use (v1.1.1). Last commit Nov 2025 |
| **EasySnec** | `Navigation-Games/EasySnec` | Python 3.14, Slint UI, `sportident` lib, uv, Nuitka | Hand-written by the student team (Quinn Bowers, Alex Ambarchian, Ivy Wong, Oomi Pammit, Alice, and others) | Active. v0.1.1, last merge Nov 2026 |
| **NGZ** | `bidwbb/ngz` (this repo) | TypeScript, Electron, React/Vite, `serialport` | Barb + Claude | v0.1.1, released installers for Win/Mac/Linux |
| _(library)_ **GecoSI** | `Navigation-Games/GecoSI` (fork of Simon Denier's) | Java | Simon Denier. Fork changed only rxtx → jSerialComm and moved to Gradle | Used by EasyGecNG. NGZ's protocol layer is a TypeScript port of it |

All three serve the same purpose. A child finishes an orienteering course (usually Animal-O at a school or youth event) and puts their SI card in a station. The screen then shows a big happy or sad face, plays a sound and lists what they missed. All three find the child's course automatically from the punches, so nobody has to register runners first.

> **Assumption to check:** I took "the three programs" to mean EasyGecNG, EasySnec and NGZ. I treated GecoSI as their shared foundation, not as one of the three.

---

## 1. How each program works

### 1.1 EasyGecNG (Java/Swing)

**Lineage:** Geco (a full event-results system) → EasyGec (a simpler French version for school events, UNSS) → EasyGecNG (Navigation Games' fork, with English fixes, smiley mode as the default, CSV import and release CI).

**Flow:**
1. `IhmEasyGec` is the main Swing window: about 1,500 lines covering menus, toolbar toggles and tables.
2. `SIReaderHandler` wraps GecoSI's `SiHandler`, which sets the zero hour to 9:00 and calls `connect(port)`. GecoSI runs the station in **handshake mode with the extended protocol** and calls `handleEcard(SiDataFrame)` for each card.
3. `handleEcard` turns the frame into a `ResultatPuce` (card result: card id, start, finish, `Partiel[]` punches) and opens `IhmResultatPuce`.
4. `EasyGec.affecterResultatsSiOrienteurs()` checks the card against **every** course (`Circuit`):
   - **inline courses** use `outils/EnLigne.java`: Levenshtein alignment after removing codes that aren't on the course, then a traceback to mark each control OK or PM (missing).
   - **score courses** use `outils/AuScore.java`: set matching.
   - The course with the fewest PMs is chosen.
5. With `autoResult` on (smiley mode, the default since 2025), `IhmSmiley` opens full-screen and always on top. It picks one of three faces:
   - green smiley: nothing missed
   - "surprised": some controls missed, listed by index
   - "late": start and/or finish punch missing, with a "Missed Start/Finish" caption

   Sounds are WAV files (applause, encouragement, oh no). One click pauses the screen and a second click closes it. There is also a timer setting (`tempo`).

**Beyond readout**, EasyGecNG is a small results system:
- Event files (`.egc` XML) holding courses, runners and results.
- Course import from OCAD/IOF XML (`XmlOcadCircuit`) and CSV/SSV (`CsvCircuits`), including English-style Orienteer CSV.
- A runner list (`Orienteurs`) that maps card numbers to names, with CSV import.
- Rankings and detailed results exported as HTML or CSV, plus SI log import (`CsvSiLog`, `IhmImportSI`).
- **ABC mode**: maps control codes to letters (`MappagesAbc`) so a course spells a word.
- **UNSS mode**: scoring rules for French school sport.
- **Six UI languages** (`lang.xml`: FR, EN, NL, DE, ES, HU) and PDF help.
- Fixed start time ("heure") as an alternative to the start-box punch.

**Pain points (from Erkan's notes in EasySnec `TODO.md` and the repo):**
- No icon, and a terminal window opens next to the app.
- Users must install Java 8 and unzip a folder.
- Animal-O isn't built in.
- Adding stations while building a course is tedious.
- It asks to save events that are empty.
- The source is encoded in windows-1252 and mostly French-named.
- No tests.
- Licensing has a TODO in the README.

### 1.2 EasySnec (Python/Slint)

**Purpose:** "Python prototype of EasyGecNG." It's a fresh, kiosk-only rewrite by the student team. In 2026 it moved from Qt to Slint.

**Flow (`src/easysnec/app.py`):**
1. `AppWindowPy` is the Slint window. Slint timers poll ports every second and **the SI reader every 100 ms** (`request_check_si`).
2. The SI layer is `sportident.SIReaderReadout` (the PyPI `sportident`/`sireader` package). It calls `poll_sicard()`, `read_sicard()` and then `ack_sicard()`, which makes the station beep.
3. `InputData.from_si_result()` turns the card into card id, start, finish and `(code, datetime)` punches.
4. **Course detection:** `get_courses_sorted()` ranks the enabled courses by Damerau–Levenshtein distance between the raw punch list and the course's stations. The closest one is graded, and the others stay in a dropdown so an organizer can regrade against a different course.
5. **Grading (`grading.py`):**
   - `INCOMPLETE` if the start or finish punch is missing or finish < start.
   - `SUCCESS` only if the punch list **exactly equals** the course. Score-O only needs set equality.
   - `MISSES` otherwise.

   Mistakes are listed per course index. "Shuffle" is reported when nothing is missing but the order is wrong (swap detection, PR #50). Extra punches are listed and shown as emoji.
6. **Feedback:** three statuses map to faces (Yay, Oops, TryAgain), with an animation. The app plays a **random MP3** from `sounds/good|med|bad`.
7. **Courses:** `CourseManager` holds **hard-coded course sets** ("Cambridge Plays Animal-O 10s" / "5s"). Organizers can turn each set on or off in the UI. Course upload and the course editor are stubs.
8. **Dev tooling:**
   - `--mock` opens a second window that pretends to be a station.
   - pytest tests cover grading.
   - Ruff linting, PR test CI, Nuitka single-file builds for 3 OSes, Inno Setup on Windows, and a Nix flake.

**Not done yet (from `TODO.md` and the code):** course upload (backend and UI), color scheme, more faces and emoji mappings for mistakes. Score type is fixed to Animal-O. `OutputData` is unused.

### 1.3 NGZ (TypeScript/Electron) — this repo

**Flow:**
1. **Main process (`electron/main.ts`)** opens the port at 38400 baud through `SiSerial` and creates `SiDriver`. `SiDriver` is a state machine ported from GecoSI; it handles startup, checks for the extended protocol and handshake mode, reads cards and waits for removal. Card data goes to the renderer over IPC as `DRIVER_CARD_READ`. Status and raw protocol logs go over IPC too.
2. **Card parsing (`SiDataFrame.ts`)** covers SI5, SI6/6\*, SI8/9/10/11/SIAC and 192-punch mode, all ported from GecoSI.
3. **Renderer (`App.tsx`):**
   - Removes punches outside the card's start–finish window, so cards don't need clearing between runs.
   - Calls `autoDetectCourse()`.
   - Plays a tone made with WebAudio: a rising chime or a falling buzz.
   - Shows `ResultScreen` (a CSS happy or sad face, card number, time, course, ✓/✗ for each control with split times, extra controls).
   - Auto-closes after 10 seconds. A click pauses, and a second click closes.
4. **Validation (`src/course-validator/validator.ts`)** is a direct port of EasyGec's `EnLigne` (Levenshtein alignment) and `AuScore`. The course with the fewest missing controls wins. On a tie, the longer course wins. **Extra punches never make a run fail.**
5. **Courses:**
   - The built-in **Animal-O** event has 10 courses: six of 5 controls and four of 10.
   - Users can add events by pasting text (`Lion: 31, 33, 36`) or by importing IOF XML v3 (file dialog or paste).
6. **Log screen:** read history (OK/PM) and the raw protocol log.
7. **Packaging and tests:**
   - electron-builder makes NSIS and portable builds for Windows, a DMG for Mac and an AppImage for Linux. Tagging a version triggers the GitHub Actions release.
   - 49 Jest tests use real card fixtures from GecoSI.
   - There is also a CLI reader (`src/cli.ts`).

---

## 2. Design decisions to review

These are the places where the three programs disagree or where a choice was made without discussion. Each needs a deliberate answer.

### 2.1 Grading semantics (the most important one)

| Question | EasyGecNG | EasySnec | NGZ |
|---|---|---|---|
| Do extra punches (controls not on the course) make the run fail? | No | **Yes** (exact list match) | No |
| Do repeated punches make the run fail? | No | **Yes** | No |
| Out of order on an inline course? | Fails (PM) | Fails, labeled "shuffle" when nothing is missing | Fails (PM) |
| Missing start or finish punch? | Separate "late" face and caption | `INCOMPLETE` status with its own face | **Ignored.** A run can show a happy face with no finish punch |
| Old punches on an uncleared card? | Not handled as far as I can tell | Not handled. With exact matching, old punches cause a failure | Removed using the start–finish window |
| Score-O | Supported | Supported in code, unreachable in the UI | Supported in the validator, unreachable in the UI (every course is created inline) |

**Decide:**
- (a) Should extra or doubled punches count against a child? (For beginners the usual answer is "no, but mention them.")
- (b) Is a missing start or finish a third result state? EasyGec and EasySnec say yes, NGZ says no. NGZ should probably add it.
- (c) Should "right controls, wrong order" get a gentler message than "missed controls"? EasySnec's swap detection is a nice idea.

### 2.2 Course auto-detection
- EasyGec and NGZ pick the course with the fewest missing controls, and NGZ breaks ties by preferring the longer course. EasySnec ranks raw edit distance, so extra punches affect which course it picks.
- None of them has an **"unknown course" threshold**. If a card matches nothing well, the app still grades it against the nearest course and shows a sad face.
- Only EasySnec lets an organizer **regrade against a different course** after reading. That's useful when detection guesses wrong.
- EasySnec also limits detection to the course sets that are switched on. That reduces ambiguity when a site has many overlapping courses.

### 2.3 What counts as "Animal-O" — the data doesn't agree
- **NGZ:** Blue Jay, Bee, Crab, Dog, Lion, Elephant (5 controls each); Sheep, Frog, Octopus, Penguin (10 each); all on controls 31–40.
- **EasySnec:** the same codes, but "Bird" instead of "Blue Jay", split into two course sets that can be switched on separately. Emoji are tied to control codes (31=🦁 …).
- **EasyGecNG `data/Animal-O_31-40 & 41-50.egc`:** a different set (Lion, Dog, Pig, Elephant, Frog, Sheep, Tiger, Turtle, Fish, plus score courses) on two code blocks.
- **Decide:** one canonical Animal-O definition in one shared data file, with an owner. Erkan's note asks for it to be built in **and** editable, and possibly loaded from the website.

### 2.4 SI communication strategy
- GecoSI and NGZ (its port) use an event-driven state machine. They require the station to use the **extended protocol + handshake mode + readout mode** and refuse to start otherwise.
- EasySnec polls through the `sportident` Python library, which supports more station settings. It is a third-party dependency with its own quirks.
- NGZ owns its protocol code (tested with real card fixtures). That means full control and no runtime dependency, but also code to maintain.
- **Decide:** keep the station-setting requirements strict and documented, or support autosend as well. Also decide whether the protocol layer should be shared, e.g. if NGZ's TS port matures into a library.

### 2.5 Platform and runtime
| | Install experience | Size/weight | Who can work on it |
|---|---|---|---|
| EasyGecNG | Install JRE 8, unzip, run a `.bat`; terminal window visible | Small | Java devs; code is French-named and windows-1252 encoded |
| EasySnec | Nuitka single binary + Inno installer (newish) | Medium | **Python: the student team's language** |
| NGZ | One-click installers on all 3 OSes, already released | Large (Electron ≈ 100 MB+) | TS/React devs; Claude-assisted |

None of the three is code-signed, so Windows SmartScreen and macOS Gatekeeper show warnings.

### 2.6 Scope: kiosk or results system?
EasyGecNG does both: readout plus runner names, rankings and HTML/CSV export. EasySnec and NGZ do **readout only** and keep nothing. NGZ loses custom events and read history when it closes, and so does EasySnec.

**Decide** which of these the new tool must keep:
- persistence of events and reads
- export of results (CSV)
- card → name mapping
- rankings
- fixed start time
- ABC mode
- UNSS
- languages other than English

### 2.7 Feedback design
- **Faces:** EasyGec has 3 static PNGs, EasySnec has 3 custom SVG faces with animation, and NGZ has 2 drawn in CSS.
- **Sounds:** EasyGec has 3 WAVs, EasySnec picks randomly from three folders of MP3s, and NGZ makes two tones in WebAudio.
- **Closing the result screen:** NGZ closes it after 10 s or by click-pause-click. EasyGec uses click-pause-click and a timer.
- **Shared assets:** the faces and sounds could be shared assets used by every implementation.

### 2.8 Engineering practice
| | Tests | CI on PRs | Lint | Release automation |
|---|---|---|---|---|
| EasyGecNG | none | none | none | on tag |
| EasySnec | pytest (grading) | **yes** | Ruff | on tag (Nuitka) |
| NGZ | Jest, 49 tests (protocol/driver/queue). **The validator has no tests** | only on tag | none | on tag |

---

## 3. Current goals (as I read them; please confirm)

1. **Kid-friendly instant feedback** at school and youth events: big face, sound, and what you missed, shown as an animal or an index rather than a raw code.
2. **No setup friction:** a one-click installer, no Java, no terminal, Animal-O built in, connect and go.
3. **Easy course entry:** better than EasyGec's station-by-station editor. Paste text, import IOF XML from Purple Pen/OCAD/Condes, maybe pull courses from the Navigation Games website.
4. **Forgiving to running an event:** works on uncleared cards, auto-detects the course, lets organizers fix a misdetection.
5. **Maintainable by the team** that will actually be around: tests, CI, readable code, a clear license.
6. **Eventually replace EasyGecNG** for Navigation Games' typical event.

---

## 4. Proposed plan

### Phase 0 — Decide (no code)
1. **Choose the long-term home.** The deciding factor is who will maintain it.
   - If the student team is the long-term maintainer, **EasySnec is the main product**. NGZ then becomes the reference and testing ground, and its features get ported over: the punch window, IOF XML import, protocol robustness, installers.
   - If Barb plus Claude-assisted development is the main engine, **NGZ is the main product**. EasySnec's UX ideas get pulled in: swap detection, the incomplete state, course-set switches, regrading, mock station, animated faces.
   - Running two apps for the same job long-term doubles the work, so pick one by a set date.
2. **Settle the grading rules in §2.1** and write them down as a short spec.
3. **Settle the canonical Animal-O data (§2.3)** and the scope list (§2.6).

### Phase 1 — Shared spec and test vectors (helps whichever app wins)
- `courses/animal-o.json`: the canonical course data, including emoji or animal per code.
- `grading-cases.json`: input punches, start/finish, and courses → expected detected course, status (OK / MISSED / INCOMPLETE / SHUFFLED) and per-control results. Include cases for uncleared cards, doubled punches, extra punches, swaps and missing finish.
- Run these cases in both NGZ (Jest) and EasySnec (pytest) so the two behave the same until one is retired.

### Phase 2 — Close NGZ's gaps (if NGZ continues)
1. Add an **incomplete state** for a missing start or finish (third face and sound). Right now a missing finish can still show a happy face.
2. Add **validator tests** (none exist yet), driven by the shared cases.
3. **Save events and read history** to disk (main process, JSON in `userData`) and add CSV export of the read history.
4. Add a **regrade dropdown** on the result screen, plus course-set switches.
5. Add **swap/shuffle detection** and gentler messages. Show animal names or emoji for missed controls.
6. Make **score-O** and **fixed start** selectable in the UI. Today the code supports them but the UI can't reach them.
7. Add an **"unknown course" threshold**, with a neutral face for "couldn't match a course."
8. Add a **mock station** for development without hardware: a fake `SiPortAdapter` that replays card fixtures.
9. Engineering:
   - CI on PRs (tests + build)
   - ESLint/Prettier
   - split `App.css`
   - remove the duplicate `npm install serialport` steps from the README dev section
   - list `cli.ts` in the CLAUDE.md architecture

### Phase 3 — Distribution and polish
- Code signing (Windows/macOS), or at least clear instructions for the warnings.
- Auto-update (electron-updater, or a "new version" check).
- Shared art and sound assets with Navigation Games branding.
- Optional: load course sets from the Navigation Games website.

### Phase 4 — Retire EasyGecNG for kiosk use
- Once the chosen app reaches parity on what matters, move EasyGecNG to "legacy: use for ranked results only," or archive it.
- Parity means: Animal-O, missing start/finish handling, course import, saved events and CSV export.
- Settle the EasyGecNG licensing TODO either way, since NGZ's validator is a port of it.

---

## 5. Open questions for Barb
1. Which app should be the main product, and who maintains it in 2027?
2. Should extra or doubled punches ever make a child's result sad?
3. Is Navigation Games' Animal-O the NGZ/EasySnec 31–40 set, or the EasyGecNG 31–40 & 41–50 set?
4. Which EasyGecNG features are truly needed: runner names, rankings, exports, ABC, UNSS, other languages?
5. Is Electron's size acceptable on the laptops used at events?
6. Should course sets come from the website, and in what format? IOF XML is the obvious choice.
