/**
 * True while a modal `<dialog>` (confirm, number prompt, shortcut sheet) is
 * open.
 *
 * The app's own key handlers sit on `document`, and a dialog's keystrokes
 * bubble there like any other: with a confirmation on screen, ↓ skipped to the
 * next episode and ← seeked behind the backdrop. Every global handler asks
 * this first, and so does the Now Playing sheet's Escape, which belongs to
 * whatever is stacked above it.
 *
 * A dialog stays `[open]` for the length of its closing animation, so the
 * answer is also true for those last ~180 ms — a second Escape must not fall
 * through to the layer underneath.
 */
export function modalOpen(): boolean {
  return document.querySelector('dialog[open]') !== null;
}
