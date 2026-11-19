# Navigation Games SI Readout Software — Overview & Plan

_Written 2026-11-19. It covers three programs that do the same job, plus the library two of them build on:_

| Program | Repo | Stack | Authorship | Status |
|---|---|---|---|---|
| **EasyGecNG** | `Navigation-Games/EasyGecNG` (fork of Thierry Porret's EasyGec, which forks Simon Denier's Geco) | Java 8, Swing, Gradle | Hand-written. Original French authors, then Charlie Moore, Quinn Bowers, Oomi Pammit, Ivy Wong, Barb | In use (v1.1.1). Last commit Nov 2025 |
| **EasySnec** | `Navigation-Games/EasySnec` | Python 3.14, Slint UI, `sportident` lib, uv, Nuitka | Hand-written by the tech dev team (Quinn Bowers, Alex Ambarchian, Ivy Wong, Oomi Pammit, Alice, and others) | Active. v0.1.1, last merge Nov 2026 |
| **NGZ** | `bidwbb/ngz` (this repo) | TypeScript, Electron, React/Vite, `serialport` | Barb + Claude | v0.1.1, released installers for Win/Mac/Linux |
| _(library)_ **GecoSI** | `Navigation-Games/GecoSI` (fork of Simon Denier's) | Java | Simon Denier. Fork changed only rxtx → jSerialComm and moved to Gradle | Used by EasyGecNG. NGZ's protocol layer is a TypeScript port of it |

All three serve the same purpose. A child finishes an orienteering course (usually Animal-O at a school or youth event) and puts their SI card in a station. The screen then shows a big happy or sad face, plays a sound and lists what they missed. All three find the child's course automatically from the punches, so nobody has to register runners first.

> **Assumption to check:** I took "the three programs" to mean EasyGecNG, EasySnec and NGZ. I treated GecoSI as their shared foundation, not as one of the three.

A detailed code walkthrough and review of EasySnec is in [`docs/EASYSNEC_REVIEW.md`](docs/EASYSNEC_REVIEW.md).

## 0. Decisions & desired behavior (from Barb, 2026-11-19)

### Grading
- **Extra and repeated punches are fine.** They never make a run fail. They may be shown as information.
- **Card punch order beats station timestamps.** Correctness comes from the order punches are stored on the card. Timestamps are only for showing times and for spotting old punches on uncleared cards, with a tolerance. Station clocks are often out of sync.
- **Missing start or finish:** if the controls are right, the child still gets the **happy face**. The screen also says we can't give a time: _"We can't give you a time because you didn't punch Start"_ (or Finish, or both). This is a "no time" flag, not a failure state.
- **Backwards:** if the run doesn't match any course forwards but is a perfect match for a course in reverse, the screen says so (_"You did Lion backwards!"_), but it is still a **sad face**. Other wrong-order runs get "right animals, wrong order" when nothing is missing.
- **No matching course:** when the best match is too weak, show a neutral "We couldn't tell which course you did" screen, list the punches, and let the organizer pick a course from a dropdown.
  - **Recommendation: require at least half the course found in order (3 of 5, 5 of 10), not 40%.** 40% of a 5-control course is 2 controls.
  - A quick simulation: 5 random punches from 31–40, scored against the six 5-control Animal-O courses, *always* match at least 2 of 5 in order on some course, and 54% of the time match 3 of 5.
  - So no threshold can tell "tried Lion and struggled" apart from random punching when the courses share 10 codes. The threshold mainly catches the wrong set of controls, an almost-empty card, or the wrong course set.
  - Make the threshold a setting. Also flag **ties** ("Lion or Dog?"), and rely on the regrade dropdown for the rest.

### Courses
- **Built-in default course sets** that can be switched on and off (an EasySnec-style toggle):
  1. **New Animal-O, 31–40**
  2. **New Animal-O, 41–50**
  3. **Old Animal-O**
  4. **Basketball-O** (probably the same in new and old)
- **Data needed from Barb.** I found two different Animal-O sets and no Basketball-O codes anywhere (`curriculum` and `website` repos included):
  - **Set A** (NGZ and EasySnec, "Cambridge Plays", 31–40 only, matching the teaching kit's "six 5-animal + 10-animal" clue sheets):
    - fives: Lion 31 33 36 38 39 · Dog 33 32 40 38 34 · Bee 35 37 38 40 33 · Bird/Blue Jay 36 34 31 38 37 · Elephant 37 34 31 40 39 · Crab 39 31 32 35 37
    - tens: Frog · Octopus · Penguin · Sheep
  - **Set B** (EasyGecNG `data/Animal-O_31-40 & 41-50.egc`, mirrored on 41–50):
    - fives: Lion, Frog, Turtle, Sheep, Tiger, Fish
    - tens: Lion (31–40 in order), Dog, Pig, Elephant, Frog, Sheep, Tiger
    - two score courses that include one stray code from the other block (score 31–40 contains 42; score 41–50 contains 32). Probably a data-entry slip.
  - Which is "new" and which is "old"? Is new Animal-O on 41–50 the same courses shifted by 10?
  - Course data should live in **one JSON (or IOF XML) file per course set**, shared by whichever app we keep.

### Course types in the UI
- **Inline** (default), **Score-O** and **Poison-O** should all be selectable.
- **Poison-O**, as defined in the curriculum: safe controls are those on the runner's map; any other control in the event is poison.
  - Proposed scoring: safe controls found − poison controls punched.
  - The face is happy if the run is all safe and every safe control was found. Otherwise "you found N, punched M poison".
  - This is the one course type where an extra punch *does* count against you.
  - Poison-O needs an event-wide list of all controls, so it knows which extra codes are poison and which are just stray.

### Other
- **Saving:** events and course sets, plus a log of every read (CSV export).
- **Tests for everything:** shared grading test cases (JSON) plus unit tests in each codebase.

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

**Purpose:** "Python prototype of EasyGecNG." It's a fresh, kiosk-only rewrite by the tech dev team. In 2026 it moved from Qt to Slint.

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
| Do repeated punches make the run fail? | No | **Yes** for inline courses (score-O ignores repeats) | No |
| Out of order on an inline course? | Fails (PM) | Fails, labeled "shuffle" when nothing is missing | Fails (PM) |
| Missing start or finish punch? | Separate "late" face and caption | `INCOMPLETE` status with its own face | **Ignored.** A run can show a happy face with no finish punch |
| Old punches on an uncleared card? | Not handled as far as I can tell | Not handled. With exact matching, old punches cause a failure | Removed using the start–finish window |
| Score-O | Supported | Supported in code, unreachable in the UI | Supported in the validator, unreachable in the UI (every course is created inline) |

**Decided (2026-11-19):** extra and repeated punches are fine. They never make a run fail, though they may be shown. EasySnec needs to change to match: today `Grade.status` compares the whole punch list for exact equality (set equality for score-O), so any extra punch gives `MISSES`. Its own unfinished `xfail` test cases already expect extras to be ignored for score-O.

**Proposed: card memory order is what counts for correctness, not station timestamps.** Station clocks can drift apart, but the card stores punches in the order they were made.
- NGZ's parser and validator already use memory order. Punches are never sorted by time.
- The **only** place time decides correctness is the start–finish window filter in `App.tsx`, which removes old punches from uncleared cards. If a control's clock is ahead of the finish clock or behind the start clock, a real punch gets dropped and shows as missed.
- Fix: keep the filter only for its real job (old punches from an earlier run). Give it a tolerance of several minutes, don't trim against the finish time at all, and use times only for showing race time and splits.
- The trade-off: on an uncleared card with badly drifted clocks, an old run's punches could slip through. Matching against the *latest* occurrences of each code reduces that risk. Clearing cards removes it.

**Still to decide:**
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
| EasySnec | Nuitka single binary + Inno installer (newish) | Medium | **Python: the tech dev team's language** |
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
1. **Choose the long-term home.** See §6 for the technical assessment. The deciding factor is who will maintain it.
   - If the tech dev team is the long-term maintainer, **EasySnec is the main product**. NGZ then becomes the reference and testing ground, and its features get ported over: the punch window, IOF XML import, protocol robustness, installers.
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
1. Which app should be the main product, and who maintains it in 2027? (See §6.)
2. ~~Should extra or doubled punches ever make a child's result sad?~~ **Decided: no** (except Poison-O).
3. Which Animal-O set is "new" and which is "old" (§0)? Can you send the Basketball-O codes?
4. Which EasyGecNG features are truly needed: runner names, rankings, exports, ABC, UNSS, other languages?
5. Is Electron's size acceptable on the laptops used at events?
6. Should course sets come from the website, and in what format? IOF XML is the obvious choice.
7. What threshold feels right for "couldn't tell which course"? I recommend at least half, configurable.
8. Is the Poison-O scoring in §0 right? Does a Poison-O event have one list of all controls?

---

## 6. Which codebase to take forward? (assessment, 2026-11-19)

### 6.1 Platform reach

| | EasySnec (Python + Slint, Nuitka) | NGZ today (Electron) | **Web app (TypeScript, built from NGZ's core)** | EasyGecNG (Java 8) |
|---|---|---|---|---|
| Windows | ✅ unsigned exe | ✅ unsigned installer/portable | ✅ Chrome/Edge | ✅ needs Java |
| macOS | ✅ Apple Silicon only (no Intel build yet) | ⚠️ arm64 DMG only. **The v0.1.1 release notes say it does not work on Macs yet** | ✅ Chrome/Edge | ✅ needs Java |
| Linux | ✅ | ✅ AppImage | ✅ Chrome/Chromium | ✅ |
| **Chromebook** (common in schools) | ❌ | ❌ | **✅ Web Serial works on ChromeOS** | ❌ |
| **Android** tablet/phone + USB-OTG | ❌ (Slint's Android support is for Rust/C++, not Python) | ❌ | ⚠️ Possible. Web Serial reached Chrome **beta** for Android in April 2026 (v148). The other route is WebUSB plus a JavaScript CP210x driver, which already exists in open-source projects. Needs testing on real devices | ❌ |
| iPad / iPhone | ❌ | ❌ | ❌ (Safari has neither Web Serial nor WebUSB) | ❌ |
| Firefox / Safari on desktop | n/a | n/a | ❌ (Chromium-based browsers only) | n/a |

The USB driver situation is the same for every option. Windows needs the CP210x driver; macOS, Linux and ChromeOS generally have it built in.

### 6.2 Sharing with clients (teachers, clubs)

1. **Web app:** send a link. No install, no unsigned-binary warnings, and updates arrive automatically. As a PWA it can be "installed" to the dock or desktop and works offline after the first visit. It can be hosted free (GitHub Pages or the Navigation Games site).
2. **NGZ/Electron:** one-click installers already exist. They're large: v0.1.1 is 82 MB (Windows exe), 99 MB (DMG) and 109 MB (AppImage), because each one bundles a whole copy of Chromium and Node. The NGZ *code* itself is only about 1,700 lines of TypeScript plus CSS. They're also unsigned, so Windows SmartScreen and macOS Gatekeeper show warnings.
3. **EasySnec/Nuitka:** a single binary. It's smaller, but just as unsigned, and Nuitka one-file binaries are known to trigger antivirus false positives. No Intel Mac build yet.
4. **EasyGecNG:** install Java 8, unzip, run a `.bat`. The worst of the four.

### 6.3 Is a browser version insane? No.
- **Web Serial** has been stable in Chrome, Edge and Opera on desktop since 2021 (Chrome 89). It reads and writes a serial port exactly as our desktop code does.
- **Others already do this.** There are open-source SPORTident readers that run in the browser (the `sportident` / `sportident-webusb` npm packages).
- **NGZ's core is mostly ready.**
  - `SiDriver` already talks to the port through a small `SiPortAdapter` interface (write / setBaudRate / close).
  - The course checker is already browser-safe.
  - The renderer is already browser code.
  - The work: replace about 25 uses of Node's `Buffer` with `Uint8Array`, write a Web Serial adapter, and move the per-card logic (punch filtering, choosing the course) out of `App.tsx` into the core.
- **Local files work with permission.** A web app can't browse the disk on its own:
  - *Saving its own data* (events, course sets, read log) goes into private browser storage. No prompt, but it lives inside the browser.
  - *Opening a file* (e.g. an IOF XML course file) needs the user to pick it in a file dialog or drag it onto the page.
  - *Saving or exporting* is either an ordinary download (CSV) or, in Chrome/Edge, a "Save as" dialog. After that, the app can keep writing to that same file (e.g. an auto-saving read log) once the user grants permission. Chrome can remember the permission for installed apps.
- **Offline:** as an installed PWA, the app is cached on the device after one online visit and then runs with no internet. Data stays in local storage, with CSV export as a backup.
- **Kiosk features are all available in the browser:** full screen, Web Audio sounds, wake lock (stops the screen sleeping), storage in IndexedDB, and file export by download.
- **Limitations:**
  - Chromium browsers only.
  - The user must click "Connect" and pick the port once per session (a browser security rule). Chrome can remember the permission.
  - Android needs testing.

### 6.4 Code quality, judged against the features we want
The features we want are:
- grading rules set by a spec
- course sets loaded from data files
- inline, Score-O and Poison-O courses
- saving
- tests for everything
- several platforms

That points to one shape: a **pure core library** (protocol, grading, course data, all tested against shared test cases) with a **thin UI** on top.

- **NGZ** is closest to that shape. Protocol, course checking and UI are separate layers, the core has no UI dependencies, and 49 protocol tests use real card data. Weak spots:
  - `App.tsx` is dense and holds logic that belongs in the core.
  - No saving.
  - The course checker has no tests.
- **EasySnec** is very readable Python with a nice UI and a good mock. Its problems:
  - Grading would need rewriting (see the review).
  - Serial I/O blocks the UI thread.
  - State lives at class level.
  - The Slint Python bindings are still beta and force workarounds.
  - It depends on a third-party SI library we don't control. The library is fine, but its behavior is set by someone else.
  - Above all, **it can never run in a browser, on a Chromebook or on Android.**
- **EasyGecNG** is the reference for features, not a base for new work.

### 6.5 Recommendation
- **Technically, the strongest path is one TypeScript codebase.**
  - A core package (protocol, grading, course data) that is browser-safe and tested against shared test cases.
  - A **web/PWA front end** as the main way to deliver it.
  - The same UI optionally wrapped in Electron for offline/kiosk laptops or non-Chromium users.
  - NGZ's `src/` becomes that core. Its renderer becomes the web app.
- **EasySnec's best ideas should come across:**
  - regrade dropdown
  - course-set toggles
  - swap detection
  - the incomplete state
  - the mock station
  - animated faces and its sound sets
- **The real question is people, not technology.** EasySnec has a team that has been active for a year. Options:
  - (a) Invite them onto the TypeScript/web codebase. React and TypeScript are widely known, and the grading spec and test cases they write carry over directly.
  - (b) Keep EasySnec as the desktop app and accept that it can't serve Chromebooks or Android, with both apps held to the same shared test cases.
  - (c) Keep both for a season, then decide.
  - I'd lean toward (a), and ask the team tonight how they feel about it.
- **Not recommended:**
  - Running Python in the browser (Pyodide). The serial library EasySnec uses can't work there, so it would mean rewriting the I/O layer anyway.
  - A Rust/Slint rewrite (Navigation-Games has a `sportident-rs` fork and a `navgames_prototype_rust` repo, which I haven't reviewed). That would reach Android natively, but it's the biggest effort for the fewest contributors.

### 6.6 Technology options, pros and cons

| Option | Download size | Platforms | Pros | Cons |
|---|---|---|---|---|
| **Web app / PWA (TypeScript)** | ~1 MB, loaded from a URL | Win/Mac/Linux/ChromeOS in Chrome or Edge; Android possible | Share by link; no install, signing or updates to manage; reuses NGZ's core; huge pool of web developers; Claude is strong here | Chromium browsers only; one "pick the port" click per session; offline use needs a PWA; Android unproven |
| **Electron (NGZ today)** | 80–110 MB | Win/Mac/Linux | Full Node access; same TypeScript and React as the web; mature tooling | Big downloads; unsigned builds trigger warnings; Mac build reported broken; no Chromebook/Android |
| **Tauri (TypeScript UI + small Rust shell)** | ~5–15 MB (estimate) | Win/Mac/Linux; mobile support is newer | Small installers; can reuse the web UI unchanged | Serial I/O must be done in Rust (a plugin); macOS/Linux web views (WebKit) differ from Chrome; another toolchain to learn |
| **Python + Slint (EasySnec)** | tens of MB (Nuitka one-file; not measured) | Win/Mac/Linux | Python is the tech dev team's language and widely known; small codebase; native-feeling UI | Slint's Python bindings are beta; no browser/ChromeOS/Android; Nuitka binaries trip antivirus; UI-thread blocking needs care |
| **Python + Qt (PySide6)** (EasySnec used this before moving to Slint) | ~100 MB+ | Win/Mac/Linux | Very mature, well documented | Heavy; the team already moved away from it; still no browser/Android |
| **Java Swing (EasyGecNG)** | small, plus a Java install | Win/Mac/Linux | Works today; full feature set | Java 8 install; old UI toolkit; French-named, untested code |
| **Rust + Slint** | ~10 MB | Win/Mac/Linux, Android natively | Fast, small, single binary; mobile possible | Steepest learning curve; fewest contributors; a total rewrite |

### 6.7 Code signing (any desktop build)

**What it is.** Signing attaches a certificate to the app that proves who published it and that nobody has changed it since. Unsigned apps trigger Windows SmartScreen ("Windows protected your PC") and macOS Gatekeeper ("can't be opened" / "is damaged") warnings. A web app needs no signing, because HTTPS hosting provides the trust.

| Platform | Steps | Rough cost |
|---|---|---|
| **Windows** | 1. Get a certificate. Easiest: Microsoft's cloud signing service, **Trusted Signing** (recently renamed Artifact Signing). Navigation Games verifies as an organization. The alternative is an OV certificate from DigiCert, Sectigo etc., whose key must live on a hardware token or cloud HSM. 2. Add the Trusted Signing GitHub Action (or electron-builder's `azureSignOptions`) to the release workflow. 3. Expect SmartScreen to still warn until the app builds download reputation. | ~$10/month (Trusted Signing), or ~$200–500/year (vendor certificate) |
| **macOS** | 1. Enroll Navigation Games in the **Apple Developer Program** (a fee waiver exists for some nonprofits). 2. Create a **Developer ID Application** certificate. 3. Store the certificate (as a .p12) and an App Store Connect API key as GitHub secrets. 4. electron-builder signs and **notarizes** automatically when `CSC_LINK`, `CSC_KEY_PASSWORD` and the `APPLE_API_KEY*` variables are set. For Nuitka, use `codesign` + `xcrun notarytool submit` + `xcrun stapler staple`. 5. Build both arm64 and x64 (or universal) so Intel Macs work. | $99/year |
| **Linux** | Not expected for AppImage | — |

**Likely link to NGZ's Mac problem.** The v0.1.1 notes say NGZ doesn't work on Macs. Unsigned, un-notarized apps downloaded on recent macOS are often reported as "damaged". The workaround is System Settings → Privacy & Security → **Open Anyway**; the old right-click → Open shortcut no longer works on macOS 15. Signing and notarizing should fix it. This is still unconfirmed until someone tests on a Mac.

### 6.8 Sources
- [Chrome Web Serial docs](https://developer.chrome.com/docs/capabilities/serial)
- [Intent to Ship: Web Serial on Android](https://groups.google.com/a/chromium.org/g/blink-dev/c/HBJ-uYFvkpM)
- [Chrome 148 Beta for Android adds Web Serial](https://www.notebookcheck.net/Chrome-148-Beta-for-Android-adds-Web-Serial-SharedWorker-support.1269721.0.html)
- [sportident-webusb (npm)](https://www.npmjs.com/package/sportident-webusb)
- [WebUSB-CP2102 driver](https://gh.r-mj.com/calcite/WebUSB-CP2102)
- [Slint language integrations (Python = beta)](https://docs.slint.dev/latest/docs/slint/language-integrations/)

