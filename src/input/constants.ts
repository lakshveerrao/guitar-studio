/**
 * Timing constants shared between the playing-state engine and the input
 * devices, so both sides agree on what counts as "still ringing".
 */

/** Seconds a string may ring and still accept a hammer-on / pull-off instead of a fresh pick. */
export const LEGATO_WINDOW_SECONDS = 1.8
export const LEGATO_WINDOW_MS = LEGATO_WINDOW_SECONDS * 1000
