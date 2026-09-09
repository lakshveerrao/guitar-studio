# Guitar Studio — Virtual Electric Guitar

A playable, browser-based electric guitar: six strings, 22 frets, chords, strumming, bends, vibrato, palm mute, hammer-ons / pull-offs, an amp head with eight models, a six-pedal effects board, tuner, metronome, backing beats, riff trainer, event looper, keyboard controls and native Gamepad API support.

Everything runs locally with the Web Audio API. No backend.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build to dist/
npm test         # tuning / string-model tests (vitest)
```

## How to play

- **Neck**: click any string/fret to fret and play it. Drag a held note upward to bend (up to +2 semitones). The **O/×** column to the left of the nut sets each string open or muted.
- **Body**: click a string over the pickups to pick it, or drag vertically across the strings in the strum zone to strum.
- **Keyboard**: `1`–`6` pick strings, `A S D F G H J K L ;` fret 1–10 on the selected string (`Shift` = +10), `↓`/`Space` down strum, `↑` up strum, `M` palm mute, `B` bend, `V` vibrato, `,` `.` change chord, `R` record, `?` help.
- **Gamepad**: open the CONTROLLER tab, connect any Gamepad API device (including an ESP32 board that enumerates as a HID gamepad), and map buttons / axes / axis directions to actions with the Learn buttons. Axis 1 ± drives down/up strums by default.

## Architecture

```
src/
  audio/    KarplusStrong.ts (string model), StringVoice.ts, GuitarEngine.ts,
            AmpEngine.ts, EffectsChain.ts, Metronome.ts, DrumMachine.ts,
            Studio.ts (signal graph), presets.ts
  input/    InputManager.ts (action bus), GuitarController.ts (playing state),
            KeyboardInput.ts, GamepadInput.ts, Recorder.ts, RiffTrainer.ts
  music/    tuning.ts, notes.ts, chords.ts, scales.ts, riffs.ts
  state/    store.ts (tiny external store + useStore hook)
  components/ Guitar, ChordPanel, AmpPanel, EffectsPanel, Tuner, Metronome,
              RiffTrainer, Looper, ControllerPanel, Layout, ui
```

Signal path: strings → pickup resonance → tone/volume → compressor → overdrive → distortion → amp (pre-gain → waveshaper → EQ → presence → cabinet) → chorus → delay → reverb → master → limiter → output.

All inputs (pointer, keyboard, gamepad, looper playback, trainer) dispatch the same `Action` objects through `InputManager`, so a motion controller can be added by dispatching actions from a new input module without touching the engine.
