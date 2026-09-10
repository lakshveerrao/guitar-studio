# Known issues — round-2 audit (2026-09-10)

Found by a 6-reviewer audit of the post-fix code. Verification was cut short, so these are **reported, not confirmed**.
Nothing here breaks normal play; they are polish and edge cases for a future pass.

| Severity | File | Line | Issue |
|---|---|---|---|
| high | `EffectsChain.ts` | 265 | Reverb runs two full convolutions after the first room change (idle convolver never stops) |
| high | `AiroMoteInput.ts` | 815 | Bend stays applied forever when the fret hand switches from chords mode to lead mode |
| medium | `GuitarEngine.ts` | 150 | A strum renders all six Karplus-Strong buffers synchronously inside the input handler (8-19 ms measured) |
| medium | `Guitar.tsx` | 67 | Guitar re-renders on every raw bend step although it only displays the 0.5-rounded value |
| medium | `AiroMoteInput.ts` | 830 | Turning 'Wrist roll bends the note' off while the wrist is rolled leaves the bend stuck on all strings |
| medium | `AiroMoteInput.ts` | 809 | Palm mute stays engaged when 'Strum-hand button holds palm mute' is switched off while the button is held |
| medium | `AiroMoteInput.ts` | 445 | Stroke in progress survives a role change: bend permanently frozen on the fret hand and a phantom strum when the role returns |
| medium | `AiroMoteInput.ts` | 818 | Single-device play: a downstroke that ends with the hand held down bends the chord 250 ms later on the shared X axis |
| medium | `AiroMoteInput.ts` | 621 | Every reconnect wipes a manually chosen controller role (regression) |
| medium | `AiroMoteInput.ts` | 445 | setRole() leaves an in-flight stroke behind: bend frozen forever on the fret role, phantom strum when switching back |
| medium | `AiroMoteInput.ts` | 1065 | Settings toggles never release held motion gestures (stuck bend / stuck palm mute) |
| medium | `MetronomePanel.tsx` | 79 | Escape in the BPM field commits the typed draft instead of discarding it |
| low | `Guitar.tsx` | 294 | noteLabels memo rebuilds 132 <text> elements on every frets change for no visible effect |
| low | `GuitarController.ts` | 98 | Every action performs an unconditional inputSource store.set, doubling store notifications during continuous input |
| low | `GamepadInput.ts` | 121 | Permanent requestAnimationFrame poll loop runs even with no gamepad connected |
| low | `LooperPanel.tsx` | 50 | LooperPanel calls setState every animation frame while playing or recording |
| low | `AiroMoteInput.ts` | 712 | A link drop during GATT service discovery is reported as 'not an AiroMote or UART device' |
| low | `MotionPanel.tsx` | 149 | Roll bar is pinned at full scale and flips sides at rest because it shows raw roll on an upside-down sensor |
| low | `AiroMoteInput.ts` | 463 | 'Set centre here' during lead tracking forgets the tracked string, so leaveLead cannot restore it |
| low | `GamepadInput.ts` | 73 | Removing the last gamepad binding silently resurrects all 13 defaults |
| low | `AiroMoteInput.ts` | 712 | Link drop during GATT setup reports the wrong error ('not an AiroMote or UART device; use the HID option') |
| low | `KeyboardInput.ts` | 37 | Code-first fret row steals the physical Semicolon key, making palm mute (M) unreachable on AZERTY |
| low | `Transport.ts` | 104 | catchUp drops steps that are still in the future after a stall |
| low | `Transport.ts` | 92 | Client joining a running grid can have its first step scheduled in the past (off-grid first hit) |
| low | `EffectsChain.ts` | 265 | Reverb room change reloads a convolver that is still fading out, cutting its tail abruptly |
| low | `StringVoice.ts` | 184 | Lazy vibrato LFO is single-target: a new pluck detaches it from the note still releasing, stepping its pitch |
| low | `AiroMoteInput.ts` | 712 | BLE link drop during GATT setup is reported as 'not an AiroMote' and never auto-reconnects |
| low | `HidInput.ts` | 304 | Any HID report >= 32 bytes whose first byte is 0xA5 is diverted to the AiroMote decoder and dropped from the gamepad mapping |
| low | `index.html` | 7 | No <link rel="icon">: every load fetches /favicon.ico through the SPA rewrite and gets index.html back |
| low | `PlayPanel.tsx` | 115 | Bend button onBlur zeroes bends it did not start (keyboard B / motion bend cancelled on any focus change) |
| low | `Guitar.tsx` | 52 | Pickup tap tolerance is ~2-3 CSS px and any string-line crossing during the press plucks and cancels the tap |

## Detail

### [high] EffectsChain.ts:265 — Reverb runs two full convolutions after the first room change (idle convolver never stops)

ReverbPedal permanently wires wetIn into BOTH ConvolverNodes (mk(), line 228: `this.wetIn.connect(c)` for c0 and c1). A room change (a Room knob step, or any preset whose reverb.room differs from the current one, e.g. default room 4 -> 'Crystal Clean' room 3 via applyPreset -> effects.apply -> reverb.set) loads the new IR into the idle convolver and only crossfades the two OUTPUT gains (lines 264-268). The previously active convolver keeps its 0.4-4 s stereo impulse response and keeps receiving the live signal, so it performs its full FFT convolution on every render quantum forever, with the result multiplied by 0 downstream (Web Audio pulls a node's inputs regardless of downstream gain). From the first swap onward the reverb costs two convolutions instead of one for the rest of the session; later swaps just alternate roles. Until the first swap c1 has no buffer (ConvolverNode with null buffer outputs silence cheaply), which is why a fresh page does not show it. The convolver is by far the most expensive node in this graph, so this doubles the audio-thread cost of the reverb on every device once a preset or the Room knob is touched.

**Fix:** Give each convolver its own input GainNode (wetIn -> inGain[i] -> convolvers[i]). On a swap ramp inGain[old] to 0 with the same 0.06 s constant as convGains[old]; then, after the crossfade plus the old IR's length (e.g. setTimeout(irSeconds * 1000 + 200)), set convolvers[old].buffer = null (or wetIn.disconnect(convolvers[old])) so the idle convolver is both silent-input and bufferless, and only re-assign/re-connect when it is next needed. Chrome's silent-input tail logic then skips it, and every browser stops the FFT work because the buffer is gone.

### [high] AiroMoteInput.ts:815 — Bend stays applied forever when the fret hand switches from chords mode to lead mode

With a dedicated fret-hand device in fretMode 'chords', a wrist roll >= 20 deg from centre dispatches BEND q>0 and records it in lastBend (lines 830-846). Clicking 'Lead - full motion' makes setSettings() only run leaveLead() (line 1074); nothing releases the bend. From then on gestures() takes the `role === 'fret' && fretMode === 'lead'` branch (line 815) which never evaluates the bend, so lastBend stays >0, store.bend stays >0 and GuitarEngine.setBend keeps bendCents on all six StringVoices; StringVoice.pluck applies bendCents to every new note (StringVoice.ts:103). Every lead note the strum hand sounds is detuned by up to 2 semitones and the only way out is to switch back to chords mode and roll the wrist back inside the dead zone. Confirmed by probe: after the switch and 20 packets at the centre pose, store.bend === 1.3 and zero BEND actions were emitted. Highly likely in practice because the auto-captured centre is usually a desk pose, so the wrist is >20 deg off-centre when the user clicks the mode button.

**Fix:** In AiroMoteInputImpl.setSettings, when prev.fretMode !== this.settings.fretMode (or when bendEnabled/buttonMute change), call a public release on every device (e.g. make releaseHeld() public and invoke it), so a held BEND 0 / PALM_MUTE off is dispatched. Alternatively compute the bend target unconditionally in gestures() (target 0 whenever the bend path is not active for the current role/mode/setting) and dispatch whenever it differs from lastBend.

### [medium] GuitarEngine.ts:150 — A strum renders all six Karplus-Strong buffers synchronously inside the input handler (8-19 ms measured)

GuitarEngine.strum (lines 150-162) calls playNote -> StringVoice.pluck (StringVoice.ts 89-90) -> renderPluck for every active string synchronously in whatever handler started the strum: Guitar.tsx onPointerDown/onPointerMove (a mouse sweep pays it inside pointermove), keydown, the gamepad rAF poll, or a BLE notification. Measured with the current code in plain Node (same V8 as Chrome) at 48 kHz on this desktop: single low E at sustain 5 = 6.81 s of audio, 3.1 ms; Em strum at sustain 5 = 33.6 s of audio, median 7.9 ms / max 14.6 ms; at sustain 10 (every string hits the 8 s maxSeconds cap) = 47.3 s of audio, median 19.2 ms / max 28 ms. A high-sustain strum therefore already exceeds a whole 60 Hz frame on a desktop, blocking rendering, the rig's rAF and the string wobble for that frame; slower devices scale linearly with the same code. The per-note single allocation and the early normalisation (no second full pass) are in place and verified; this is the remaining, largest main-thread cost in the app.

**Fix:** Only the first string is needed inside the 5 ms look-ahead; string i starts at t0 + i*gap with gap = 15-45 ms. In strum(), play string 0 synchronously and schedule each following string in its own macrotask (chain setTimeout(..., 0) per string, passing the precomputed time/velocity) so each task is at most one render and a paint can interleave. StringVoice.pluck already picks the start time after rendering (`max(o.time, now + 3 ms)`), so a late task plays slightly late rather than being clamped into the past, and the NoteEvent listeners (recorder, trainer, stampPluck) use e.time so their behaviour is unchanged. Longer term, run renderPluck inside an AudioWorkletProcessor (it is a pure function of params + seed) so no render happens on the main thread at all.

### [medium] Guitar.tsx:67 — Guitar re-renders on every raw bend step although it only displays the 0.5-rounded value

Guitar is the largest React tree in the app (~200 SVG elements: strings, pegs, status column, markers, note labels). It subscribes to the raw `bend` (line 67) but only uses `bend > 0` (lines 424-425) and `Math.round(bend * 2) / 2` (line 453). A mouse bend drag dispatches BEND on every pointermove whose amount moved by more than 0.02 (lines 244-248), i.e. up to ~100 distinct values across a 2-semitone bend at pointer-event rate (60-120 Hz); the gamepad path emits 0.05 steps at 60 Hz (GamepadInput.ts 285-289) and the motion path 0.1 steps. Each step is a store.set that re-renders Guitar, plus StatusBar (StatusBar.tsx line 30, which also only shows the 0.5-rounded value at line 76), PlayPanel and Tuner. Roughly 25 of every 26 Guitar reconciliations during a bend produce no DOM change.

**Fix:** Select the display value in the hook so useSyncExternalStore skips unchanged snapshots: in Guitar.tsx `const bend = useStore((s) => Math.round(s.bend * 2) / 2)` (bendString stays as is; `bend > 0` and the +x.x label are unaffected), and the same in StatusBar.tsx. Keep the raw value only where it is shown continuously (PlayPanel bar width, Tuner cents).

### [medium] AiroMoteInput.ts:830 — Turning 'Wrist roll bends the note' off while the wrist is rolled leaves the bend stuck on all strings

The bend path is gated by `if (st.bendEnabled)` (line 830). If the toggle is switched off while lastBend > 0, no BEND 0 is dispatched and the branch is never entered again, so store.bend and the engine's bendCents keep the last value for the rest of the session (every subsequent pluck is detuned, StringVoice.ts:103). setSettings (lines 1065-1076) does not release anything when bendEnabled changes. Confirmed by probe: bend 1.3 remains after disabling and returning the wrist to centre. Pre-existing before the fix round, but still present.

**Fix:** In setSettings, when bendEnabled goes true -> false, dispatch BEND 0 for every device whose lastBend > 0 (reuse releaseHeld()). Or restructure gestures() so the bend target is computed as 0 when the feature is disabled and dispatched whenever it differs from lastBend.

### [medium] AiroMoteInput.ts:809 — Palm mute stays engaged when 'Strum-hand button holds palm mute' is switched off while the button is held

PALM_MUTE is only tracked inside `if (st.buttonMute && s.button !== this.buttonDown)` (line 809). Hold the button (PALM_MUTE on, buttonDown = true), switch the toggle off, release the button: the release packet is ignored, buttonDown stays true, store.palmMute stays true and every strum/pick is rendered palm-muted (GuitarController passes st.palmMute to strum/playNote) until the device disconnects or the setting is re-enabled and the button pressed again. Confirmed by probe: palmMute === true after release. Pre-existing before the fix round.

**Fix:** In setSettings, when buttonMute goes true -> false, call releaseHeld() on strum-hand devices (dispatches PALM_MUTE off and clears buttonDown). Or track the button edge unconditionally and dispatch PALM_MUTE off whenever buttonDown is true and the feature is inactive.

### [medium] AiroMoteInput.ts:445 — Stroke in progress survives a role change: bend permanently frozen on the fret hand and a phantom strum when the role returns

setRole() (lines 445-450) calls releaseHeld() and leaveLead() but never resets the strum detector (stroke, strumArmed, belowSince). If a swing has crossed the threshold but not peaked (up to STROKE_MAX_MS = 120 ms) when the role becomes 'fret' - which autoAssignRoles() does automatically to a lone slot-1 device the instant a second controller connects (line 1090) - detectStrum() is never called again for that device, so this.stroke stays non-null. In chords mode `frozen = this.stroke !== null` (line 834) is then always true and the wrist bend never updates for the rest of the session. When the other controller leaves and the device goes back to 'both', the first packet hits `now - k.start >= STROKE_MAX_MS` (line 874) and fires a strum from a resting hand. Confirmed by probe: 0 BEND actions while rolled 50 deg after the role change; a `gyro.x = 0` packet after returning to 'both' emitted STRUM_DOWN (strength 0.63).

**Fix:** Factor the detector reset out of releaseAll() into a resetStrumDetector() (stroke = null, strumArmed = true, belowSince = null, lastStrokeSign = 0) and call it from setRole() as well. Also make the fret-hand-only bend freeze depend on strumHand (`frozen = strumHand && (this.stroke !== null || (sharedAxis && strumRecent))`) so a non-strumming device can never be frozen by stale strum state.

### [medium] AiroMoteInput.ts:818 — Single-device play: a downstroke that ends with the hand held down bends the chord 250 ms later on the shared X axis

In role 'both' with the default strumAxis 'x' the code itself states roll is the integral of gyro X (comment at line 831). The fix round only freezes the bend during the stroke and for BEND_HOLD_AFTER_STRUM_MS = 250 ms after it (lines 818, 834). A 150 ms half-sine swing peaking at 600 deg/s rotates the wrist by about 600*(2/pi)*0.15 = 57 deg; the hand normally rests in that lowered position until the next upstroke. As soon as the hold expires, line 838 measures |roll - centre.roll| = ~57 deg and dispatches BEND ((57-20)/45*2 = 1.6 st) on all strings of the chord that was just strummed, releasing again only when the hand comes back up. The user hears the strummed chord dive/bend after every downstroke instead of a clean sustain. Reproduced in a probe with a swing whose roll integrates to 28 deg past centre: BEND 0.4 fired once the hold expired. The existing test only covers a swing whose roll returns to centre within the swing.

**Fix:** After fireStrum() on the shared axis, latch the bend (e.g. bendLatched = true) and only clear the latch once |angleDelta(roll, centre.roll)| has re-entered the 20 deg dead zone; while latched, treat the bend target as 0. Alternatively re-base the bend origin to the roll observed when the stroke settles (first sample with |rate| < thr/2 after the strum) so a bend is measured from the post-stroke rest pose, not from the pre-stroke centre.

### [medium] AiroMoteInput.ts:621 — Every reconnect wipes a manually chosen controller role (regression)

The diff moved autoAssignRoles() into update() so it now runs on every connected-set change, including the success path of scheduleReconnect() (line 781) and the 'reconnecting' transition in onDisconnected() (line 762). Before eacab2a a reconnect only called update({state:'connected'}) and roles were untouched. Consequences, reproduced against the real source with a scratch vitest probe: (1) a lone controller the user set to 'fret' (lead mode, strumming with keyboard/space) is forced back to 'both' the moment its BLE link hiccups and returns -> lead tracking stops (it needs role==='fret') and the fret hand starts emitting STRUM actions from wrist movement; (2) a pair the user swapped (dev0='fret', dev1='strum'): when dev1 drops, dev0 is forced to 'both'; when dev1 returns, autoAssignRoles sees dev0==='both' -> 'strum' while dev1 stays 'strum', leaving TWO strum hands and no fret hand (probe output: 'roles after return = strum strum'). ESP32 BLE drops are routine, so users lose their configuration mid-session without any UI indication.

**Fix:** Track whether a role was chosen by the user (e.g. `roleLocked` set in the UI path of setRole and cleared by forget()/an explicit 'auto' choice) and have autoAssignRoles() only touch unlocked devices; alternatively call autoAssignRoles() explicitly from connect()/attachExternal()/disconnect()/detachExternal() as the pre-diff code did and skip it in scheduleReconnect()'s success path and the 'reconnecting' transition, so a transient drop round-trips with the roles intact.

### [medium] AiroMoteInput.ts:445 — setRole() leaves an in-flight stroke behind: bend frozen forever on the fret role, phantom strum when switching back

setRole() calls releaseHeld() and leaveLead() but never resets the new signed-peak detector state (stroke/strumArmed/belowSince). If the role changes while a stroke is between threshold crossing and its peak (<=120 ms window per swing), detectStrum() no longer runs for role 'fret', so `this.stroke` stays non-null indefinitely. Because the chords-mode bend branch uses `frozen = this.stroke !== null || ...` (line 834), bend is silently disabled on that device until disconnect. When the role is later switched back to 'both'/'strum', the first packet hits the stale stroke: `now - k.start >= STROKE_MAX_MS` fires an immediate STRUM (probe: STRUM_DOWN strength 0.63 on a packet with rate 0). The trigger is not under the user's control: autoAssignRoles() flips a lone 'both' device to 'fret' asynchronously when the second controller connects, which can land mid-swing while the user is playing.

**Fix:** Factor the detector reset out of releaseAll() into a `resetStrumDetector()` (stroke=null, strumArmed=true, belowSince=null, lastStrokeSign=0, lastStrumAt=-Infinity) and call it from setRole(); optionally also clear `stroke` whenever the strum-hand branch is skipped in gestures().

### [medium] AiroMoteInput.ts:1065 — Settings toggles never release held motion gestures (stuck bend / stuck palm mute)

setSettings() only handles lead->chords (leaveLead). Three other transitions leave engine state behind because the gesture branches that would emit the 'off' value are simply skipped afterwards: (1) fretMode 'chords'->'lead' on a fret-role device: the bend branch (line 830) is no longer evaluated, so `lastBend` and the engine/store bend stay at the last value; probe: wrist at 50 deg -> bend 1.3, switch to lead, return wrist to centre -> store.bend still 1.3 and no BEND action ever emitted, so every lead-mode note plays ~1.3 semitones sharp until disconnect or 'Set centre here'. (2) bendEnabled=false with a bend active: same, bend 1.3 stuck (probe C2). (3) buttonMute=false while the strum-hand button is held: `buttonDown` is never updated again, so PALM_MUTE stays on after the button is released (probe C3: palmMute true after release). A user adjusting settings with a controller strapped on and a relaxed, slightly rolled wrist (>20 deg from centre) will hit case 1 immediately after enabling lead mode.

**Fix:** Expose a public `releaseGestures()` on AiroMoteDevice (calls releaseHeld()) and invoke it from setSettings() for every device when bendEnabled turns off, buttonMute turns off, or fretMode changes; or, in gestures(), emit BEND 0 when the bend branch is skipped while lastBend>0 and emit PALM_MUTE off when buttonMute is off while buttonDown is true.

### [medium] MetronomePanel.tsx:79 — Escape in the BPM field commits the typed draft instead of discarding it

The new BPM draft input's onKeyDown does `setDraft(null); e.currentTarget.blur()` for Escape. `blur()` synchronously runs the browser's unfocusing steps, so React's `onBlur={commitDraft}` executes inside the same keydown handler, before the queued `setDraft(null)` has re-rendered; `commitDraft` therefore still sees the typed draft in its closure and calls `actions.setBpm(n)`. Escape thus behaves exactly like Enter. Reproduced on the running app (bpm 123, type 144, press Escape -> store.bpm becomes 144 and the metronome/drums retune). Trigger: focus the BPM box, type any different number, press Escape.

**Fix:** Make the cancel intent visible to the blur handler independently of React state, e.g. `const cancelRef = useRef(false)`; in the Escape branch set `cancelRef.current = true` before `blur()`; in `commitDraft` do `const cancel = cancelRef.current; cancelRef.current = false; if (!cancel && draft !== null && ...) actions.setBpm(n); setDraft(null)`. (Alternatively keep the draft in a ref and clear it before blurring.)

### [low] Guitar.tsx:294 — noteLabels memo rebuilds 132 <text> elements on every frets change for no visible effect

noteLabels (lines 289-304) depends on `frets` because the loop skips the fretted note on each string (line 294). The finger marker rendered afterwards (line 430) is an opaque r=10.5 circle centred on the same (cx, cy), which fully covers the 8 px label (also in showPlayer mode, where the marker circle stays at cy), so the skip changes nothing on screen. With 'Show all notes' on, every fret change (each click on the neck, every chord change, every FRET_NOTE, and in AiroMote lead mode two FRET_NOTE dispatches per position step) rebuilds 6 x 22 = 132 text elements and makes React reconcile all of them.

**Fix:** Remove the `if (frets[s] === n) continue` line and drop `frets` from the dependency list (`[showNotes, flats]`), so the labels are built once per showNotes/flats change. Optionally move the strings/pegs and the status column into memoised children so a frets change only reconciles the marker layer.

### [low] GuitarController.ts:98 — Every action performs an unconditional inputSource store.set, doubling store notifications during continuous input

handle() calls `store.set({ inputSource: source })` for every action before doing anything else (line 98) even when inputSource is unchanged, and PICK_STRING sets selectedString unconditionally (line 127). Each store.set runs every subscriber: about 75 useStore getSnapshot selectors across the mounted panels plus the raw subscribers that do real work per notification (the player rig recomputes poseTargets with fingerAssignments/Set/filter/sort allocations on every notification, Player.tsx 258; Stage tracking; string wobble; ringing glow; the LooperPanel module subscriber). A mouse strum sweep, a bend drag, a gamepad axis move and every motion-driven action therefore pay two notifications instead of one, and one AiroMote lead-mode position step (AiroMoteInput.ts 951-959: FRET_NOTE to mute the previous string, FRET_NOTE for the new position, then update -> publish) costs five store.sets.

**Fix:** Read `st` first and guard the no-op writes: `if (source !== 'playback' && st.inputSource !== source) store.set({ inputSource: source })` and `if (st.selectedString !== a.string) store.set({ selectedString: a.string })`. In usePlayerRig's sync, compare the fields poseTargets reads (frets, chordId, lastNote, lastTechnique) against the previous state and return early when none changed.

### [low] GamepadInput.ts:121 — Permanent requestAnimationFrame poll loop runs even with no gamepad connected

GamepadInput.start() is called on App mount (App.tsx 42) and runs a rAF loop for the life of the page (lines 121-125) regardless of whether a gamepad exists: every frame it calls navigator.getGamepads(), Array.from and .find (lines 213-218). With a pad connected it also allocates the buttons/axes arrays and a snapshot object per frame (231-233) and, in evaluate(), builds a template-string stateKey per axis binding per frame (line 271). The page never gets an idle frame even when the user is only reading a panel, and this is the only unconditional per-frame work left after the fix round.

**Fix:** Start the loop from the gamepadconnected event (browsers only expose a pad after a button press anyway) and stop it in pollPads when no connected pad is found (restart on the next gamepadconnected); precompute the per-binding stateKey strings in setBindings/loadBindings instead of per frame.

### [low] LooperPanel.tsx:50 — LooperPanel calls setState every animation frame while playing or recording

While the recorder state is playing or recording, the effect at lines 45-56 runs a rAF loop that calls setPos(rec.position) every frame (and setElapsed while recording). Both values change every frame, so the whole panel re-renders at 60 Hz for the duration of the take or playback, including the timeline's events.map (one absolutely positioned div per recorded note, lines 92-106) and the Stat blocks. On the Looper tab this is the same per-frame React setState pattern that was removed from Player.tsx.

**Fix:** Drive the playhead and the length counter imperatively: keep refs to the playhead div and the Length value span, write style.left and textContent in the rAF callback (throttle the text to ~10 Hz), and only use React state for discrete changes (state, count, duration) so the events list renders once per change.

### [low] AiroMoteInput.ts:712 — A link drop during GATT service discovery is reported as 'not an AiroMote or UART device'

openGatt() swallows every getPrimaryService/getCharacteristic failure (lines 668-711). If the controller goes out of range or powers off after gatt.connect() resolved but before subscriptions finish, all three probes reject with NetworkError, `count` is 0 and line 712 throws 'Connected, but this device has no readable data stream. It is not an AiroMote or UART device; use the HID option for gamepads.' before the `droppedWhileOpening` check at line 716 is ever reached. connect() then shows state 'error' with that misleading text, and scheduleReconnect() after MAX_RECONNECT_ATTEMPTS shows 'Lost connection: Connected, but this device has no readable data stream...'. The user is told their AiroMote is the wrong kind of device when the link simply dropped.

**Fix:** Check `this.droppedWhileOpening` (and `!device.gatt?.connected`) before the `if (!count) throw` at line 712 - ideally right after each swallowed failure - and throw 'The connection dropped while setting up.' in that case.

### [low] MotionPanel.tsx:149 — Roll bar is pinned at full scale and flips sides at rest because it shows raw roll on an upside-down sensor

`<Bar label="roll" value={sample.roll} max={90} />` clamps value/max to [-1, 1]. Both boards rest near roll = +-178 deg (documented at AiroMoteInput.ts:15-16), so t = +-1: the bar is always fully lit at rest and, as the raw reading jitters across the +-180 wrap, it jumps from fully-right to fully-left on alternate samples. Wrist bends of 20-65 deg (the entire bend range, measured from the centre at line 838) produce no visible change. The pitch bar and the centre-relative lead mapping added in this round are correct; only this readout still uses the raw angle, so the live panel misrepresents what the gesture engine actually sees.

**Fix:** Show the centre-relative angle the gestures use: `value={angleDelta(sample.roll, status.centre?.roll ?? sample.roll)}` (export angleDelta is already available), keeping max={90}. Optionally label it 'roll from centre'.

### [low] AiroMoteInput.ts:463 — 'Set centre here' during lead tracking forgets the tracked string, so leaveLead cannot restore it

setCentre() calls resetLeadPosition() (line 463), which sets leadString/leadFret to -1 while leadEngaged and leadMuted stay set. If the device is disconnected (or its role/mode changes) before the next packet re-seeds the position (the fret hand streams at 30-110/s, so the window is 10-33 ms, but also any time packets stop right after the click), leaveLead() at line 988 sees trackedString === -1 and skips restoring the fretted string: the five muted strings return to open but the tracked string keeps its lead fret (probe: frets = [0,0,0,10,0,0] after calibrateLead() then detachExternal()). The user is left with one string silently fretted at e.g. fret 10 after leaving lead mode.

**Fix:** In setCentre(), remember the tracked string/fret before resetting (e.g. keep leadString/leadFret intact and only clear leadSeeded so the next packet re-seeds from the new centre), or restore the tracked string to open there via the same logic leaveLead() uses, so the restore does not depend on a packet arriving in between.

### [low] GamepadInput.ts:73 — Removing the last gamepad binding silently resurrects all 13 defaults

sanitizeBindings() returns DEFAULT_BINDINGS whenever the cleaned list is empty, and the diff made setBindings() (line 155) route through it. ControllerPanel's remove button calls `GamepadInput.setBindings(bindings.filter(x => x !== b))`; deleting the final binding therefore stores and applies the full default table instead of an empty one, so a user who wants only a custom mapping (or no gamepad mapping at all while using WebHID) cannot get there: the last removal un-does all their deletions and re-enables e.g. axis-1 strums and face-button chord changes. Pre-diff setBindings persisted [] as given.

**Fix:** Only fall back to the defaults when loading an absent/corrupt key: have sanitizeBindings() return the filtered list (possibly empty) and let loadBindings() substitute DEFAULT_BINDINGS when `raw` is null or parsing failed, while setBindings() persists whatever valid subset the user left.

### [low] AiroMoteInput.ts:712 — Link drop during GATT setup reports the wrong error ('not an AiroMote or UART device; use the HID option')

openGatt() sets droppedWhileOpening when gattserverdisconnected fires mid-setup but only checks it at line 716, after the service discovery. If the drop happens after gatt.connect() resolves (common with the 15 s timeout path and flaky ESP32 links), getPrimaryService(AiroMote) and (NUS) reject and are swallowed, getPrimaryServices() rejects -> services=[] -> count===0 -> the 'no readable data stream ... use the HID option for gamepads' error is thrown at line 712 before the droppedWhileOpening check is reached. connect() then sets wantConnected=false and shows that message, so a real AiroMote with a bad link is reported as a non-AiroMote device and the user is steered to the wrong feature; no reconnect is attempted.

**Fix:** Check `this.droppedWhileOpening` before the `if (!count) throw` (and ideally right after gatt.connect() resolves and after each failed service lookup) so a dropped link always surfaces as 'The connection dropped while setting up.'

### [low] KeyboardInput.ts:37 — Code-first fret row steals the physical Semicolon key, making palm mute (M) unreachable on AZERTY

fretIndex() matches KeyboardEvent.code before e.key, and FRET_CODES includes 'Semicolon'. On French AZERTY the physical Semicolon position prints 'm', so pressing M (documented as hold-to-palm-mute in the help overlay and in this file's header) now dispatches FRET_NOTE fret 10 and returns before the `case 'm'` branch; onUp likewise takes the fret path. Palm mute therefore cannot be triggered from the keyboard on AZERTY at all. Pre-diff matching was by e.key, where M worked and ';' (physical Comma on AZERTY) was fret 10.

**Fix:** Resolve the printed key first: if normKey(e) is one of the bound command/hold keys ('m','b','v','r','x',',','.', digits...) handle it as such; otherwise map the fret row by e.code with e.key as the fallback. Alternatively drop 'Semicolon' from the code table and keep only normKey's ':'->';' fold for fret 10.

### [low] Transport.ts:104 — catchUp drops steps that are still in the future after a stall

When the next unscheduled index is more than MAX_LATE (250 ms) in the past, catchUp() returns stepAtOrAfter(now + START_AHEAD) with START_AHEAD = 0.05. That skips every grid step in the window [now, now + 50 ms) even though those steps are not late and could still be scheduled sample-accurately. Reproduced with the real Transport class and the Metronome.schedule() loop: after a stall with beat k exactly 30 ms in the future, schedule() emitted nothing that tick and the next click landed one full beat later (a 575 ms gap at 110 bpm). It is also inconsistent with the non-stall path, which happily fires a beat that is up to 250 ms in the past. Trigger: any main-thread stall > 250 ms while the metronome or drum machine is running (large IR render, applause render, GC), followed by a tick that lands within 50 ms before a beat/sixteenth.

**Fix:** Only skip what is actually late: return this.stepAtOrAfter(now + small margin such as 0.005) (or plain now), since Web Audio only needs the event to be ahead of the audio thread, not 50 ms ahead. Update the Transport.test.ts expectation `timeOf(next - 1) < now + 0.05` accordingly.

### [low] Transport.ts:92 — Client joining a running grid can have its first step scheduled in the past (off-grid first hit)

firstStep() picks the first grid step at or after now + 0.02, but neither Metronome.start() (Metronome.ts:66-67) nor DrumMachine.start() (DrumMachine.ts:137-138) calls schedule() synchronously; the first schedule() runs on the setInterval tick >= TICK_MS (25 ms) later, plus whatever the React re-render triggered by the same click costs. Any step falling in [now+20 ms, now+25 ms+jitter) is therefore handed to Web Audio with a time already in the past, so it is clamped to 'now' and plays late and off the shared grid. Simulation with the real Transport (5000 random join phases, 0-10 ms timer jitter): 6.3% of drum-machine joins had the first hit in the past, worst 14.7 ms late. This is precisely the moment a user checks that the drums start on the metronome click. The very first client is unaffected because acquire() puts the origin 50 ms ahead.

**Fix:** Call this.schedule() at the end of start() in both Metronome and DrumMachine right after computing the first step (the origin/first step are already in the future), or raise firstStep's default `ahead` to at least TICK_MS/1000 + 0.02 (i.e. reuse START_AHEAD = 0.05) so the first step can never precede the first timer tick.

### [low] EffectsChain.ts:265 — Reverb room change reloads a convolver that is still fading out, cutting its tail abruptly

ReverbPedal.set() alternates between two convolvers and crossfades their gains with tau 0.06 s (~0.3 s to settle). On the second room change within that window (e.g. dragging the Room knob: integer boundaries are crossed roughly every 100 ms), `this.convolvers[next].buffer = ir` is assigned to the convolver whose gain is still at e^(-0.1/0.06) ~ 19% of full (-14 dB). Assigning a new buffer resets the convolver's internal state, so its still-audible output jumps to zero instantly instead of decaying - the exact click/tail-cut the dual-convolver design was added to remove, just at reduced level. The convolver then starts convolving from empty state while its gain ramps up, so the tail is also not preserved into the new room.

**Fix:** Track the audio time of the last swap and, if a new room arrives before the previous fade has settled (t - lastSwap < ~0.3 s), defer the swap with a timer that applies the latest requested room once the idle convolver's gain has reached ~0 (coalescing rapid knob moves), or keep the idle gain ramp and only assign `buffer` after that settle time.

### [low] StringVoice.ts:184 — Lazy vibrato LFO is single-target: a new pluck detaches it from the note still releasing, stepping its pitch

Before this change lfoGain fanned out to every sounding source's detune and was disconnected in dispose(). Now attachLfo() (called from pluck() at line 104 whenever vibratoDepth > 0) first runs detachLfo() on the previous note's detune while that note is still audible in its release (6 ms for a pick, 30 ms crossfade for a hammer-on/pull-off). The LFO contribution (up to +/-depth cents, 25 default and up to 80 from the PlayPanel slider) vanishes instantaneously from that note, so the outgoing note jumps in pitch by up to the full vibrato depth mid-crossfade; most audible on legato runs with vibrato held. The same single-target design also causes an instant pitch step when setVibrato(depth>0) re-attaches to a newly plucked note within the 300 ms detach window while lfoGain is still mid-fade (non-zero gain connected without a ramp).

**Fix:** Keep the lazy creation and the ramped depth, but allow fan-out again: connect lfoGain to each new source's detune in pluck() and disconnect that specific param in dispose() (as the pre-merge code did); drop lfoTarget/detachLfo-on-attach. For the re-enable case, ramp lfoGain from 0 (setValueAtTime(0) then setTargetAtTime) when attaching to a note that was not previously connected.

### [low] AiroMoteInput.ts:712 — BLE link drop during GATT setup is reported as 'not an AiroMote' and never auto-reconnects

The new `droppedWhileOpening` mechanism (set by `onDisconnected` at line 751-754 while `opening` is true) is only consulted at line 716, AFTER the raw-fallback branch has already thrown. When the link drops between `gatt.connect()` resolving and the subscription completing (board reset, out of range, flaky adapter), every subsequent GATT call rejects with NetworkError: the AiroMote attempt (669-675) and UART attempt (677-685) are swallowed, `getPrimaryServices()` (689) rejects into `services = []`, `count` stays 0, and line 712 throws 'Connected, but this device has no readable data stream. It is not an AiroMote or UART device; use the HID option for gamepads.' `connect()` then (lines 550-556) sets `wantConnected = false` and shows that message as the device error. The user is told their AiroMote is not an AiroMote, and unlike a drop that happens one second later (which goes through `onDisconnected` -> 'reconnecting'), no reconnect is attempted. The same wrong text is what ends up in 'Lost connection: ...' after the reconnect path exhausts its attempts.

**Fix:** In `openGatt`, check `this.droppedWhileOpening` before the `!count` throw (and after each failed protocol attempt): `if (this.droppedWhileOpening) throw new Error('The connection dropped while setting up.')`. Optionally, in `connect()`'s catch, when `this.droppedWhileOpening` is set and `this.device` exists, keep `wantConnected = true`, set state 'reconnecting' and call `scheduleReconnect()` instead of surfacing an error.

### [low] HidInput.ts:304 — Any HID report >= 32 bytes whose first byte is 0xA5 is diverted to the AiroMote decoder and dropped from the gamepad mapping

`onReport` routes a report to `AiroMoteInput.device(0).feed()` and returns solely on `data.byteLength >= 32 && data.getUint8(0) === 0xa5`, without checking the packet version or CRC. `feed()`/`decodeMotionPacket` then reject the bytes (CRC mismatch) and silently discard them, so the report never reaches `layoutFor` parsing, `snapshot`, or `GamepadInput.processExternal`. Chromium's `inputreport.data` excludes the report ID, so byte 0 is the first payload field; on common >= 32-byte-report pads that field is an 8-bit axis (DualShock 4 / DualSense over USB: byte 0 = left-stick X, 63-byte reports). Whenever that axis reads exactly 165 (stick ~30% right), the whole report — including every button state in it — is thrown away, so button edges are delayed or missed while the stick sits there. It also unconditionally feeds slot 0 even when slot 0 is a live BLE device.

**Fix:** Only divert when the bytes actually decode as an AiroMote packet: e.g. `const bytes = new Uint8Array(...); if (bytes.length >= 32 && bytes[0] === 0xa5 && decodeMotionPacket(bytes.subarray(0, 32), performance.now())) { feed; return }` (or check `bytes[1] === 1` plus the CRC via an exported `isMotionPacket()` helper); otherwise fall through to the normal layout parsing.

### [low] index.html:7 — No <link rel="icon">: every load fetches /favicon.ico through the SPA rewrite and gets index.html back

`index.html` declares no icon, so browsers request `/favicon.ico`. `vercel.json`'s `rewrites` (`/(.*)` -> `/index.html`) answers with the HTML document (200, text/html); with `X-Content-Type-Options: nosniff` the browser discards it, leaving the tab without an icon and adding a wasted HTML fetch per navigation. `public/favicon.svg` and `public/icons.svg` are shipped to `dist/` but are the Vite/Bluesky template leftovers and are referenced nowhere (`grep` of src/ and index.html finds no use), as are `src/assets/hero.png` and `src/assets/vite.svg`.

**Fix:** Add a real icon and reference it: `<link rel="icon" href="/favicon.svg" type="image/svg+xml">` in index.html (replace the template artwork), and either delete `public/icons.svg`, `src/assets/hero.png`, `src/assets/vite.svg` or exclude static files from the rewrite (e.g. `"source": "/((?!.*\\.).*)"` or a negative-lookahead for `favicon.ico`).

### [low] PlayPanel.tsx:115 — Bend button onBlur zeroes bends it did not start (keyboard B / motion bend cancelled on any focus change)

The new `onBlur={() => store.get().bend > 0 && InputManager.dispatch({ type: 'BEND', amount: 0 }, 'keyboard')}` checks only the global bend value, not whether this button produced it. A bend button keeps focus after a mouse click (Chrome focuses buttons on click). If the user then holds `B` (KeyboardInput dispatches BEND 1) or bends via AiroMote wrist roll, and any subsequent click/tap moves focus (e.g. clicking the neck to play), the button's blur dispatches BEND 0 while the key is still held / the wrist is still rolled, and also flips `inputSource` to 'keyboard'. Reproduced: keydown 'b' -> store.bend = 1; focusing then blurring the '+1' button -> store.bend = 0 before keyup. Pre-existing `onPointerLeave` has the same pattern but the onBlur is new in this diff.

**Fix:** Track ownership: `const held = useRef(false)`; set `held.current = true` in onPointerDown/onKeyDown (when firing), set it false in onPointerUp/onKeyUp/onPointerLeave after dispatching BEND 0, and in onBlur only dispatch BEND 0 when `held.current` is true (then clear it).

### [low] Guitar.tsx:52 — Pickup tap tolerance is ~2-3 CSS px and any string-line crossing during the press plucks and cancels the tap

TAP_SLOP = 4 is in viewBox units; the svg renders at scale 0.556 in a 1310 px-wide window (measured: 2.22 px) and 0.72 at the 1180 px min-width (2.9 px), far below platform tap slop (Android 8 dp, iOS ~10 pt) and below typical trackpad click wobble. Any pointermove beyond that sets `d.moved` (line 251) so `releaseDrag` skips `actions.setPickup`. Worse, the strum loop (lines 263-276) runs regardless of slop: for a press that started on a pickup `skip` is -1, so a sub-slop move that crosses a string line pushes it into `order`, dispatches PICK_STRING (an unwanted pluck) and sets `moved = true`. The pickup pole pieces are drawn exactly on the string lines (GuitarBody.tsx line 47, `cy = stringY(s, 1300)`), i.e. where a user aims a tap. Browsers that suppress sub-slop touchmove (Chrome Android) mask this; pointer sources that deliver small moves (mouse/trackpad, other browsers) hit it.

**Fix:** Express the slop in CSS pixels (e.g. 8 px converted through the cached CTM: `slopVb = 8 / invCtm.current ? 1/inv.a : ...`, or compare `e.clientX/Y` against the pointerdown client coords), and while `d.pickup` is set and the pointer is still inside the slop, skip the string-crossing pass (`return` before computing `order`) so a jittery tap neither plucks nor loses the selection; start strumming only once the slop is exceeded.
