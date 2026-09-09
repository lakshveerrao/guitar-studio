import { useEffect, useState } from "react";
import {
  GAMEPAD_ACTIONS,
  GamepadInput,
  type GamepadSnapshot,
} from "../../input/GamepadInput";
import { useStore } from "../../state/store";
import { Section } from "../ui/controls";
import type { GamepadBinding, GamepadActionId } from "../../types";
import { HidPanel, MotionPanel } from "./MotionPanel";

function useGamepadSnapshot(): GamepadSnapshot {
  const [snap, setSnap] = useState<GamepadSnapshot>(GamepadInput.current);
  useEffect(() => {
    // throttle to ~30 fps for the UI
    let last = 0;
    return GamepadInput.onSnapshot((s) => {
      const now = performance.now();
      if (now - last > 33 || !s.connected) {
        last = now;
        setSnap(s);
      }
    });
  }, []);
  return snap;
}

function useBindings(): GamepadBinding[] {
  const [b, setB] = useState<GamepadBinding[]>(GamepadInput.currentBindings);
  useEffect(() => GamepadInput.onBindings(setB), []);
  return b;
}

function bindingLabel(b: GamepadBinding) {
  if (b.kind === "button") return `Button ${b.index}`;
  return `Axis ${b.index} ${b.direction === "negative" ? "−" : "+"}`;
}

export function ControllerPanel() {
  const snap = useGamepadSnapshot();
  const bindings = useBindings();
  const inputSource = useStore((s) => s.inputSource);
  const [learning, setLearning] = useState<GamepadActionId | null>(null);
  const [draft, setDraft] = useState<{
    action: GamepadActionId;
    kind: "button" | "axis";
    index: number;
    direction: "positive" | "negative";
  }>({
    action: "STRUM_DOWN",
    kind: "button",
    index: 0,
    direction: "positive",
  });

  // "Learn" mode: press any button / push any axis to bind it to the action
  useEffect(() => {
    if (!learning) return;
    const base = GamepadInput.current;
    const baseButtons = base.buttons.slice();
    const baseAxes = base.axes.slice();
    return GamepadInput.onSnapshot((s) => {
      if (!s.connected) return;
      for (let i = 0; i < s.buttons.length; i++) {
        if (s.buttons[i] > 0.5 && (baseButtons[i] ?? 0) <= 0.5) {
          GamepadInput.setBindings([
            ...GamepadInput.currentBindings.filter(
              (b) => b.action !== learning,
            ),
            { action: learning, kind: "button", index: i },
          ]);
          setLearning(null);
          return;
        }
      }
      for (let i = 0; i < s.axes.length; i++) {
        const d = s.axes[i] - (baseAxes[i] ?? 0);
        if (Math.abs(d) > 0.6) {
          GamepadInput.setBindings([
            ...GamepadInput.currentBindings.filter(
              (b) => b.action !== learning,
            ),
            {
              action: learning,
              kind: "axis",
              index: i,
              direction: d > 0 ? "positive" : "negative",
              threshold: learning === "BEND" ? 0.15 : 0.5,
            },
          ]);
          setLearning(null);
          return;
        }
      }
    });
  }, [learning]);

  const remove = (b: GamepadBinding) =>
    GamepadInput.setBindings(bindings.filter((x) => x !== b));
  const add = () => {
    const nb: GamepadBinding =
      draft.kind === "button"
        ? { action: draft.action, kind: "button", index: draft.index }
        : {
            action: draft.action,
            kind: "axis",
            index: draft.index,
            direction: draft.direction,
            threshold: draft.action === "BEND" ? 0.15 : 0.5,
          };
    GamepadInput.setBindings([...bindings, nb]);
  };

  return (
    <div className="flex flex-col gap-3">
      <MotionPanel />
      <HidPanel />
      <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-3">
        <Section
          title="Gamepad API"
          right={
            <span
              className={`inline-flex items-center gap-1.5 text-[11px] ${snap.connected ? "text-ok" : "text-ink-3"}`}
            >
              <span className={`led green ${snap.connected ? "on" : ""}`} />
              {snap.connected ? "connected" : "no controller"}
            </span>
          }
        >
          {snap.connected ? (
            <>
              <div className="text-xs font-semibold truncate" title={snap.id}>
                {snap.id}
              </div>
              <div className="text-[10px] text-ink-3 mono">
                index {snap.index} · {snap.buttons.length} buttons ·{" "}
                {snap.axes.length} axes · input: {inputSource}
              </div>
              <div>
                <div className="label mb-1">Buttons</div>
                <div className="grid grid-cols-8 gap-1">
                  {snap.buttons.map((v, i) => (
                    <div
                      key={i}
                      className="h-8 rounded border border-line-2 flex flex-col items-center justify-center mono text-[9px]"
                      style={{ background: `rgba(77,163,255,${v * 0.7})` }}
                    >
                      <span>{i}</span>
                      <span className="text-ink-2">{v.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="label mb-1">Axes</div>
                <div className="flex flex-col gap-1">
                  {snap.axes.map((v, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-[10px] mono"
                    >
                      <span className="w-4 text-ink-3">{i}</span>
                      <div className="relative flex-1 h-3 bg-[#0e1115] border border-line rounded">
                        <div className="absolute top-0 bottom-0 w-px bg-line-2 left-1/2" />
                        <div
                          className="absolute top-0.5 bottom-0.5 w-1.5 rounded bg-accent"
                          style={{
                            left: `calc(${((v + 1) / 2) * 100}% - 3px)`,
                          }}
                        />
                      </div>
                      <span className="w-12 text-right text-ink-2">
                        {v.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="text-[12px] text-ink-2 leading-relaxed">
              <p>
                Connect a gamepad or an ESP32 motion controller that presents
                itself as a standard HID gamepad, then press any button so the
                browser exposes it.
              </p>
              <p className="mt-2 text-ink-3 text-[11px]">
                Uses <span className="mono">navigator.getGamepads()</span>.
                Mappings work on buttons, axes and axis direction, so a tilt
                axis can drive strums directly. Nothing is required from the
                keyboard.
              </p>
            </div>
          )}
        </Section>

        <Section
          title="Mappings"
          right={
            <button
              className="btn sm"
              onClick={() => GamepadInput.resetBindings()}
            >
              Reset defaults
            </button>
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
            {GAMEPAD_ACTIONS.map((a) => {
              const bs = bindings.filter((b) => b.action === a.id);
              return (
                <div
                  key={a.id}
                  className="flex items-center gap-2 py-1 border-b border-line/60 min-w-0"
                >
                  <span className="text-xs w-40 shrink-0">{a.label}</span>
                  <div className="flex flex-wrap gap-1 flex-1 min-w-0">
                    {bs.map((b, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 mono text-[10px] px-1.5 py-0.5 rounded bg-panel-2 border border-line-2"
                      >
                        {bindingLabel(b)}
                        <button
                          className="text-ink-3 hover:text-rec"
                          onClick={() => remove(b)}
                          aria-label="remove"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {!bs.length && (
                      <span className="text-[10px] text-ink-3">unbound</span>
                    )}
                  </div>
                  <button
                    className={`btn sm ${learning === a.id ? "active" : ""}`}
                    onClick={() => setLearning(learning === a.id ? null : a.id)}
                    disabled={!snap.connected && learning !== a.id}
                  >
                    {learning === a.id ? "press…" : "Learn"}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-end gap-2 pt-2">
            <label className="flex flex-col gap-1">
              <span className="label">Action</span>
              <select
                className="sel"
                value={draft.action}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    action: e.target.value as GamepadActionId,
                  })
                }
              >
                {GAMEPAD_ACTIONS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="label">Type</span>
              <select
                className="sel"
                value={draft.kind}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    kind: e.target.value as "button" | "axis",
                  })
                }
              >
                <option value="button">Button</option>
                <option value="axis">Axis</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="label">Index</span>
              <input
                className="inp w-16 mono"
                type="number"
                min={0}
                max={31}
                value={draft.index}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    index: Math.max(0, Number(e.target.value) || 0),
                  })
                }
              />
            </label>
            {draft.kind === "axis" && (
              <label className="flex flex-col gap-1">
                <span className="label">Direction</span>
                <select
                  className="sel"
                  value={draft.direction}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      direction: e.target.value as "positive" | "negative",
                    })
                  }
                >
                  <option value="positive">Positive (+)</option>
                  <option value="negative">Negative (−)</option>
                </select>
              </label>
            )}
            <button className="btn" onClick={add}>
              Add mapping
            </button>
            <span className="text-[10px] text-ink-3 ml-auto">
              Saved in this browser. Example: Axis 1 + → Strum Down, Axis 1 − →
              Strum Up.
            </span>
          </div>
        </Section>
      </div>
    </div>
  );
}
