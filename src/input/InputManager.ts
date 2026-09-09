import type { Action, InputSource } from '../types'

export type ActionHandler = (action: Action, source: InputSource) => void

/**
 * Every input device (mouse, touch, keyboard, gamepad, future motion
 * controller) funnels through here. The guitar engine only ever sees Actions.
 */
class InputManagerImpl {
  private handlers = new Set<ActionHandler>()
  private lastSource: InputSource = 'none'

  dispatch(action: Action, source: InputSource): void {
    this.lastSource = source
    this.handlers.forEach((h) => h(action, source))
  }

  onAction(h: ActionHandler): () => void {
    this.handlers.add(h)
    return () => this.handlers.delete(h)
  }

  get source(): InputSource {
    return this.lastSource
  }
}

export const InputManager = new InputManagerImpl()
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __input: InputManagerImpl }).__input = InputManager
