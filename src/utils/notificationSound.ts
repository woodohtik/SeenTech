/**
 * playNewOrderChime — a short two-tone chime for the in-app "new order"
 * alert (seen-companion-app-task_1.md Phase 3). Synthesized via the Web
 * Audio API instead of shipping an audio asset -- no file to source/host,
 * no licensing question, and it's a handful of lines.
 */

// One shared AudioContext, created lazily on first use and reused for
// every subsequent chime -- a fresh POS-rush burst of new orders used to
// allocate (and schedule a delayed close() for) a brand-new AudioContext
// per event, and browsers cap concurrent contexts, so several chimes
// arriving within that window could start silently failing.
let sharedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (sharedCtx && sharedCtx.state !== 'closed') return sharedCtx;
  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextCtor) return null;
  sharedCtx = new AudioContextCtor();
  return sharedCtx;
}

export function playNewOrderChime(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const playTone = (freq: number, startAt: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0, ctx.currentTime + startAt);
      gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startAt + duration);
      osc.start(ctx.currentTime + startAt);
      osc.stop(ctx.currentTime + startAt + duration + 0.02);
    };

    // A rising two-note chime (not a flat beep) -- reads as "something
    // arrived", distinct from the generic toast's silent appearance.
    playTone(740, 0, 0.16);
    playTone(988, 0.1, 0.22);
  } catch {
    // Autoplay policies / unsupported browsers -- the visual alert alone
    // is still enough, sound is a nice-to-have.
  }
}
