# EasySnec — Code Walkthrough & Review

_Reviewed 2026-11-19 at `Navigation-Games/EasySnec@cd11c32` (main, after the course-sets merge in PR #60). This file lives in the NGZ repo; see [`../OVERVIEW.md`](../OVERVIEW.md) for how the three apps compare._

How the findings were checked: the grading results in §4.1 come from **running `grading.py`** against edge cases (with `slint` stubbed out). The other findings come from reading the code and the source of the `sportident` 1.2.8 library it depends on. Line numbers refer to `src/easysnec/`.

---

## 1. One-paragraph summary

EasySnec is a small, readable card-reading kiosk: about 680 lines of Python and about 740 lines of Slint UI. It has a sensible split between the SI reader, grading and the UI. It also has good engineering habits: a mock station window, typeguard in tests, Ruff, CI on PRs, and Nuitka builds for 3 operating systems. The UI looks good: an animated result panel, switchable course sets, and a dropdown to regrade against a different course.

The **grading rules are the main problem.** A run only counts as correct if the punch list is *exactly* the course. One extra or repeated punch, or old punches on an uncleared card, gives a sad face with the message "Out of Order", which is false. That conflicts with the rule we've now agreed (extras and repeats are fine). There is also a handful of crash-level bugs and some threading/robustness issues around the serial port. None of these is hard to fix.

---

## 2. Architecture

```
main.py  ──►  app.main()  (click CLI, --mock flag)
                 │
                 ├─ MockWindowPy (optional, --mock)  ── implements SerialInterface
                 │
                 └─ AppWindowPy  (subclass of the compiled Slint AppWindow)
                       │  Slint timers call Python callbacks:
                       │    every 1 s  (settings screen): request_update_ports, request_update_time
                       │    every 0.1 s (running screen): request_check_si
                       │
                       ├─ SerialInterface (Protocol)
                       │     ConcreteSerialInterface → sportident.SIReaderReadout(port)
                       │     MockWindowPy            → MockSIReader
                       │
                       ├─ CourseManager (courses.py)  — hard-coded CourseSets, enable/disable
                       │
                       └─ grading.py
                             InputData.from_si_result(dict) → get_courses_sorted(courses)
                             Grade(input, course, score_type)  → status / mistakes / to_slint()
```

### 2.1 Files

| File | Lines | What it does |
|---|---|---|
| `main.py` | 5 | Entry point that wraps `app.main()` so relative imports work under Nuitka |
| `app.py` | 322 | Loads the Slint UI, `AppWindowPy` callbacks, serial interfaces, mock reader, sound, `main()` |
| `grading.py` | 248 | `InputData`, `Grade`, `SuccessStatus`, `ScoreType`, conversion to Slint structs |
| `courses.py` | 107 | `Course`, `CourseSet`, `CourseManager` (two hard-coded Animal-O sets), animal→code and code→emoji maps |
| `ui/app_window.slint` | 153 | Root window: header, timers, switches between settings, running and editor screens |
| `ui/settings.slint` | 166 | Port dropdown, course-set toggle buttons, Start button |
| `ui/running.slint` | 166 | Result screen: course dropdown, mistake list, animated face, time |
| `ui/datatypes.slint` | 33 | Shared structs and enums (`Grade`, `Mistake`, `MistakeType`, `GuiState`) |
| `ui/course_editor.slint` | 45 | Placeholder only, not connected to anything |
| `ui/mock_window.slint` | 71 | Fake station window used with `--mock` |
| `tests/` | 328 | Grading tests: 5 real ones and 2 `xfail` placeholders. typeguard import hook in `conftest.py` |

### 2.2 A card read, step by step

1. **Connect.** Changing the settings port dropdown calls `request_connect_si(port)` (`app.py:136`). That disconnects any old reader and calls `SerialInterface.bind_si_reader(port)`, i.e. `SIReaderReadout(port)`. `SIReaderReadout` opens the port at 38400 baud and reads the station's settings. If that works, `si_connected = True` and the Start button is enabled.
2. **Start.** This changes `guiState` to `running` and starts the 100 ms `si_ping_timer`.
3. **Poll** (`request_check_si`, `app.py:150`). `poll_sicard()` drains whatever bytes are waiting and returns True if the card *changed*. That means it's True on removal as well as insertion.
4. **Read.** `read_sicard()` sends block requests and **waits for the replies, on the UI thread**. It returns a dict with `card_number`, `start`, `finish`, `check`, `clear` and `punches=[(code, datetime)]`. Times are datetimes worked out from `now()+2h` and the card's day-of-week byte.
5. `InputData.from_si_result()` wraps that dict. `ack_sicard()` makes the station beep.
6. **Pick the course.** `get_courses_sorted()` ranks every *enabled* course by Damerau–Levenshtein distance between the **raw punch list** and the course's controls. `courses[0]` is the guess, and the sorted list fills the dropdown.
7. **Grade.** `_report_output()` builds `Grade(input, course, ScoreType.ANIMAL_O)`. `to_slint()` turns it into a Slint `Grade` struct: a result string, the course name, the time as `MM:SS`, and a list of `Mistake{type, checkpoint}`.
8. **Sound.** `_make_sound()` plays a random MP3 from `sounds/good|med|bad` chosen by status. Playback is non-blocking.
9. **Display.** In `running.slint`, `changed grade => pop.start()` runs the spring animation. The face and text depend on the result string. Changing the course dropdown calls `request_regrade(name)`, which grades again against the chosen course.

### 2.3 Grading rules as implemented (`grading.py`)

```
status:
  INCOMPLETE  if start or finish missing, or finish < start
  SUCCESS     if course.stations == input.stations           (exact list equality)
  SUCCESS     if set(course) == set(input) and score_type is SCORE_O
  MISSES      otherwise
mistakes (to_slint):
  missed      every course index whose code is not punched anywhere
  no_start / no_finish
  shuffle     if not SUCCESS, nothing missed, and start+finish present
```

---

## 3. Strengths (worth saying tonight)

- **Clear structure for its size.** Data is in frozen dataclasses, with `cached_property` for things that are derived from them.
- **The UI is declarative and kept apart from the logic.** Python only sets properties and handles callbacks.
- **`SerialInterface` as a `Protocol`** with a real implementation and a mock one is the right way to make it testable. The **mock station window** is a great development tool.
- **The regrade dropdown** handles a wrong course guess well. NGZ doesn't have this.
- **Course sets you can switch on and off** cut down wrong guesses when courses overlap.
- **Swap ("Out of Order") detection** and the incomplete state (missing start or finish) are good UX ideas.
- **Engineering habits:** Ruff and pytest run on every PR. typeguard in tests. Pinned action SHAs. Builds for 3 operating systems on tag. A Nix flake. MIT license.
- The Nuitka build script is well commented. It explains *why* each `--include-*` flag is there.

---

## 4. Findings

Severity: 🔴 wrong result or crash at an event · 🟠 robustness/maintainability · 🟡 polish.

### 4.1 🔴 Extra or repeated punches give a sad face with "Out of Order" (confirmed by running it)

`grading.py:91` requires `course.stations == input_data.stations`. Results from running `Grade` against Lion `[31,33,36,38,39]`:

| Punches | Status | Mistakes shown |
|---|---|---|
| `31 33 36 38 39` | SUCCESS | — |
| `31 33 34 36 38 39` (one extra) | **MISSES** | **"Out of Order"** (`missed_checkpoint_indices == []`) |
| `31 33 33 36 38 39` (double punch) | **MISSES** | **"Out of Order"** |
| `35 37 38 40 33 31 33 36 38 39` (uncleared card: old Bee run, then Lion) | **MISSES** | **"Out of Order"** |
| `39 38 36 33 31` (backwards) | MISSES | "Out of Order" |
| `31 33 36 38 39`, no finish | INCOMPLETE | "Missed Finish" |

Double punches are very common with kids, so this will show up at real events. The fix is a **subsequence / alignment check** that ignores codes not on the course (the way EasyGec's `EnLigne` and NGZ's `validateInline` work), plus a real swap/backwards detector. The score-O branch has the same problem: `set(course) == set(input)` fails on any extra code.

### 4.2 🔴 Crash when switching a course set on or off before the first card

`request_update_course_sets` (`app.py:123`) checks `if self._input:`. But `_input` is never set until the first card is read. Only an annotation for `_input_data` exists (line 76), and nothing uses it. So clicking a course-set button on the settings screen before any card has been read raises `AttributeError` inside the callback. _(Found by reading the code; not run.)_ Fix: declare `_input: InputData | None = None` and remove `_input_data`.

### 4.3 🔴 `IndexError` when no course matches or all sets are off

`courses[0]` (`app.py:127, 177`) fails if every course set is switched off. `random.choice(all_sounds)` (`app.py:209`) fails if a sounds folder is missing from a build. `next(iter(filter(...)))` in `request_regrade` (`app.py:213`) raises `StopIteration` if the name isn't found.

### 4.4 🔴 Uncleared cards and station clocks

- No punches are filtered by the start or finish time. Old runs on a card that wasn't cleared fail the exact-equality check (see 4.1), and they also confuse the edit-distance course guess.
- The good news: the `sportident` library decodes each punch time independently. **Punches stay in card memory order**, so order-based grading isn't affected by clock drift. Keep it that way: never sort by time.

### 4.5 🟠 Serial reads block the UI thread

`request_check_si` runs inside a Slint timer callback, i.e. on the UI thread. `read_sicard()` sends commands and waits for replies with **a 5 s serial timeout** (`sportident.py:680`). A normal read takes a fraction of a second. If a child pulls the card mid-read, or the station is unplugged, the window freezes for up to several seconds. There's already a TODO ("move to coroutine"). See §8.2 for the recommended threading pattern.

### 4.6 🟠 Error handling in `request_check_si`

```python
try:
    if not self._si_reader.poll_sicard(): return
except OSError as e:
    self.si_connected = False        # ← no return: falls through to read_sicard()
```

After an `OSError` (e.g. USB unplugged), the code still goes on to `read_sicard()`. That raises `SerialException`/`OSError`, which isn't in the `except (SIReaderCardChanged, SIReaderException)` list, so the exception escapes into Slint. Add `return`, and catch `serial.SerialException`.

Also, `poll_sicard()` returns True on **removal** too. Every card removal then calls `read_sicard()`, which raises "No card in the device" and is logged as a warning. That's harmless but noisy. Check `self._si_reader.sicard is not None` before reading.

### 4.7 🟠 The score type is fixed, and `Course.is_score_o` is ignored

`_report_output` always passes `ScoreType.ANIMAL_O` (`app.py:190`). `Course` has an `is_score_o` field, but `Grade` never reads it. So we have two sources of truth and neither one is used. Suggestion: make the scoring type a property of the **course** (e.g. `kind: Literal["inline","score","poison"]`) and remove the global `ScoreType` argument.

### 4.8 🟠 Shared state at class level

- `CourseManager.course_sets: dict = {}` (`courses.py:45`) is a **class attribute**. Every `CourseManager()` shares one dict, and the `__init__` keeps re-adding the defaults to it.
- `AppWindowPy._course_manager = CourseManager()` (`app.py:77`) is also created once at import time and shared.

This works today because there's only one window. It will cause confusing bugs in tests or when a course editor or loader arrives. Move both to `__init__`, or use `field(default_factory=...)`.

### 4.9 🟠 Slint ↔ Python data passing has workarounds

- **Result as a string.** `Grade.result` is a string (`"success"|"misses"|"incomplete"`) rather than a Slint enum. In `running.slint`, the state named `incomplete` triggers on `"misses"` and the state named `fail` triggers on `"incomplete"`. The names are swapped, which will confuse the next person.
- **Sentinel numbers for mistake types.** `MistakeType` can't be matched in `states`, so the code uses the sentinel values `checkpoint = -1/-2/-3` (`grading.py` `to_slint`, `running.slint` `MistakeDisplay`). That works, but it's fragile. Worth one more try with `mistake.type == MistakeType.no-start` on current Slint, or use separate bool fields.
- **Toggle hack.** `settings.slint` flips `checked` twice in `init` so the course-set structs reach Python intact. Same kind of workaround.
- **Unused or stale code.** `app_window.slint` has defaults like `"Some other thing"`. `datatypes.slint` has `ResultType`, which is never used.

These workarounds come from using the **Python bindings for Slint, which are still labelled beta** in Slint's own docs (Slint 1.16).

### 4.10 🟠 The mock reader doesn't look like a real card

`MockSIReader.read_sicard()` returns `start: 0`, `finish: 0` and `punches=[(33, "1pm")]`. Every mock read is therefore `INCOMPLETE`, and the punch time is a string where real data has a datetime. Make the mock window let you type a list of punches, or replay recorded real card dicts (NGZ has real fixtures for SI5/6/8+ we could share).

### 4.11 🟡 Smaller items

- The window title is still `"EasyGec"` (`app_window.slint:70`).
- `from_serial_interface()` calls `default()` and then repeats its setup. `default()` builds a `ConcreteSerialInterface` that is thrown away right after.
- `score` for inline courses is `1 / seconds` and divides by zero for a 0-second run. `.seconds` ignores days. Not used in the UI yet.
- `missed_checkpoints` returns raw codes and `extra_checkpoints` returns emoji. These are inconsistent, and `scoring_output` / `OutputData` are leftovers nothing uses.
- **Dependencies:**
  - `sireader` *and* `sportident` are both listed, but only `sportident` is used (it's the newer name for the same library).
  - `pydantic` is listed but not used.
  - `pyxdameraulevenshtein` is a C extension just for one distance function. A 15-line pure-Python version would make builds simpler.
- `requires-python >= 3.14` is fine today. Check that Nuitka and the Slint wheels keep up on each release.
- `course_editor.slint` is a stub, and its `display_course` uses `course.name`/`course.checkpoints` while Python's `Course` has `course_name`/`stations`.
- **Tests:**
  - Only grading is tested. The two `xfail` tests are TODO tables, not assertions, and they're a good starting point for the shared test cases.
  - Nothing tests course detection on realistic Animal-O data, `CourseManager`, or `to_slint`.
- **Build/distribution:**
  - The macOS build runs on `macos-latest` (Apple Silicon), so there's **no Intel Mac binary**.
  - Nothing is signed. Unsigned Nuitka `--onefile` binaries are known to trip antivirus false positives on Windows, and Gatekeeper on macOS.
  - The `run_easysnec.bat` / `.ps1` scripts depend on `uv` being installed.

---

## 5. How EasySnec compares with the decided requirements

| Requirement (from Barb, 2026-11-19) | EasySnec today | Effort |
|---|---|---|
| Extra and repeated punches are fine | ❌ fail (4.1) | Small: replace equality with alignment |
| Card punch order beats station timestamps | ✅ already uses memory order | — (keep it) |
| Missing start/finish: happy face if the course is right, plus "no time because you didn't punch Start/Finish" | ❌ shows "Try Again!" with the melting face | Small |
| Default course sets: new Animal-O 31–40 and 41–50, old Animal-O, Basketball-O | Partial: two hard-coded "Cambridge Plays" sets on 31–40 | Small once the data is agreed |
| Backwards detection: tell them, but sad face | Partial: "Out of Order" only | Small |
| "No matching course" fallback | ❌ always picks the nearest | Small |
| Save events and reads | ❌ | Medium |
| Choose Score-O / Poison-O in the UI | ❌ (dropdown commented out, type fixed) | Medium |
| Course entry (paste or IOF XML) | ❌ (editor stub) | Medium |
| Tests for everything | Partial: grading only | Ongoing |
| Runs on Windows/Mac/Linux | ✅ (Nuitka; no Intel Mac) | — |
| Runs on Chromebook / Android / in a browser | ❌ not possible with Python + Slint | n/a |

---

## 6. Suggested PRs, in order (if EasySnec continues)

1. **Fix the grading rules:**
   - inline = in-order subsequence ignoring codes not on the course
   - score = all course codes present
   - swap and backwards detectors
   - a separate "no time" flag for missing start/finish that doesn't change the face

   Turn the `xfail` tables into real tests.
2. **Crash fixes:** 4.2, 4.3, 4.6.
3. **Move serial work off the UI thread** (4.5).
4. **Course data as files** (JSON or IOF XML) loaded at startup, replacing the hard-coded `CourseManager`. Store the scoring type on each course (4.7, 4.8).
5. **Persistence:** append each read to a CSV/JSONL log in the user data folder, and save course sets.
6. **A mock station that replays real card dumps** (4.10).
7. **Clean up the Slint/Python data passing** (4.9).

---

## 7. Questions to ask the team tonight

1. What's the long-term plan for who maintains this? Is the team open to the shared-spec idea (one set of grading test cases that both EasySnec and NGZ must pass)?
2. Did you choose exact-match grading deliberately (e.g. to teach precision), or was it a placeholder?
3. How was moving from Qt to Slint? Have the Python-binding workarounds (sentinels, toggle hack) cost a lot of time?
4. Have you tested on real hardware at an event? Did you see freezes when cards were pulled early?
5. How do teachers and schools get the app today? Are there Chromebook-only schools you've had to turn away?
6. Would anyone on the team be interested in a TypeScript/web version (see `OVERVIEW.md` §6), or is Python a firm preference?

## 8. Technology options for the Python route

### 8.1 Alternatives to Slint (keeping Python)

Slint is a young UI toolkit (first released 2021) whose main audience is Rust and C++ developers. You describe screens in its own declarative `.slint` language; a native renderer draws them. Its Python bindings are labelled **beta**. Its free license requires attribution (or GPL use).

EasySnec moved from Qt (PySide6 + QML) to Slint in mid-2026. The history suggests packaging and glue code were the reasons:
- the repo had build scripts for five packaging tools before the switch
- the `BackendInterface` class was full of Qt Signal/Slot/QEnum/Property declarations
- a PR was needed to fix Qt↔Python combobox synchronization

| Option | What it is | Pros | Cons |
|---|---|---|---|
| **pywebview** ⭐ | Python backend; the UI is an HTML/CSS/JS page shown in the OS's built-in browser view | Small; HTML/CSS is the most widely known UI skill; big faces, animations and sounds are easy; the UI could later be reused in a pure web app | OS browser views differ slightly; still needs Nuitka/PyInstaller packaging and signing |
| **NiceGUI** | Python-only web UI framework that runs a local server and opens a native window or browser tab | Everything in Python; modern look; good docs | A local server inside the app; packaging still needed |
| **Kivy** | Python UI toolkit with its own OpenGL renderer and layout language | Can produce **Android** apps (USB serial there needs extra Java-bridge work) | Dated look; smaller community; its own layout language |
| **Toga (BeeWare)** | Python toolkit using each OS's native widgets, with mobile targets | Native look; Android/iOS targets | Young; serial on mobile unsolved; limited widgets |
| **Tkinter / CustomTkinter** | Built into Python | Nothing extra to install; very stable | Animations and large graphics are clunky |
| **PySide6 (Qt)** | What EasySnec used before | Most mature and powerful | The packaging and glue pain they left behind; 100 MB+ |
| **Slint** (current) | — | Already built; light Python API; nice animation | Beta bindings and the workarounds in §4.9; no browser/Android from Python |

**Recommendation if staying in Python: pywebview.** Python keeps the SI reader and grading; the UI becomes plain HTML/CSS/JS, the easiest kind for anyone to work on. It's also a bridge to a pure web app later. Kivy is the only Python option that reaches Android, at a real cost in effort and polish.

### 8.2 Recommended threading pattern

Rule: **only the UI thread touches UI objects; blocking serial I/O never runs on the UI thread.**

Simplest robust design: one dedicated reader thread, and a queue that the existing UI timer drains.

```python
import queue, threading

events: queue.Queue = queue.Queue()

def reader_loop(reader, stop: threading.Event):
    while not stop.is_set():
        try:
            if reader.poll_sicard() and reader.sicard is not None:
                data = reader.read_sicard()          # blocking, off the UI thread
                reader.ack_sicard()
                events.put(("card", data))
            else:
                stop.wait(0.05)
        except (SIReaderException, SIReaderCardChanged) as e:
            events.put(("warning", str(e)))
        except (OSError, serial.SerialException) as e:
            events.put(("disconnected", str(e)))
            return

# in AppWindowPy: the existing 100 ms Slint timer now only drains the queue
@slint.callback
def request_check_si(self):
    while True:
        try:
            kind, payload = events.get_nowait()
        except queue.Empty:
            return
        ...  # grade and update UI properties here, on the UI thread
```

- The reader thread is the only code that touches the serial port, so no locks are needed around it. pyserial releases Python's lock (the GIL) while it waits for bytes, so the UI stays smooth.
- Start the thread on Start or Connect and stop it with the `Event` on disconnect. Mark it `daemon=True` so quitting the app never hangs.
- The other option is an asyncio task on `slint.run_event_loop()` that runs the blocking calls through `await asyncio.to_thread(reader.read_sicard)`. It's equally valid if the team prefers async, but the queue version is easier to reason about and test.
- Grading is fast pure Python. It stays on the UI thread.

Signing for Nuitka builds is covered in [`OVERVIEW.md` §6.7](../OVERVIEW.md).
