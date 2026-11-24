/**
 * Freeze (P): pauses CSS animations, Web Animations and media, and restores exactly
 * what was playing. Duck-typed over the document so it runs against fakes in tests.
 */

export const FREEZE_STYLE_ATTRIBUTE = "data-neuraipse-annotate-freeze";

/** Pauses every CSS animation (and pseudo-element animation) while the tag is present. */
export const FREEZE_CSS =
  "*, *::before, *::after { animation-play-state: paused !important; }";

export type AnimationLike = {
  playState: string;
  pause(): void;
  play(): void;
  /** A KeyframeEffect carries the target element. */
  effect?: object | null;
  /** Present on CSSAnimation; those are left to the freeze style tag. */
  animationName?: string;
};

export type MediaLike = {
  paused: boolean;
  ended: boolean;
  pause(): void;
  play(): Promise<void> | void;
};

export type FreezeDocument = {
  getAnimations?: () => AnimationLike[];
  querySelectorAll: (selector: string) => ArrayLike<unknown>;
  createElement: (tag: "style") => {
    setAttribute(name: string, value: string): void;
    textContent: string | null;
    remove(): void;
  };
  head?: { appendChild(node: unknown): unknown } | null;
  documentElement: { appendChild(node: unknown): unknown };
};

export type FreezeOptions = {
  /** True for animation targets that belong to the toolbar itself. */
  exclude?: (target: Element | null | undefined) => boolean;
};

export type FreezeResult = {
  /** Web Animations paused by freeze (CSS animations are paused by the style tag). */
  animations: number;
  media: number;
  unfreeze: () => void;
};

/** True for CSS animations, which the style tag pauses without touching their API state. */
export function isCssAnimation(animation: AnimationLike): boolean {
  return typeof animation.animationName === "string";
}

export function animationTarget(animation: AnimationLike): Element | null {
  const effect = animation.effect as { target?: Element | null } | null | undefined;
  return effect?.target ?? null;
}

/** Animations freeze must pause through the API: running, not CSS, not excluded. */
export function animationsToPause(
  animations: readonly AnimationLike[],
  exclude: FreezeOptions["exclude"] = () => false,
): AnimationLike[] {
  return animations.filter(
    (animation) =>
      animation.playState === "running" &&
      !isCssAnimation(animation) &&
      !exclude(animationTarget(animation)),
  );
}

/** Media elements that are currently playing. */
export function mediaToPause(media: readonly MediaLike[]): MediaLike[] {
  return media.filter((item) => !item.paused && !item.ended);
}

/**
 * Pauses the page. `unfreeze` removes the style tag and resumes only the animations and
 * media that freeze itself paused and that are still paused, so prior state is kept.
 */
export function freezePage(doc: FreezeDocument, options: FreezeOptions = {}): FreezeResult {
  const style = doc.createElement("style");
  style.setAttribute(FREEZE_STYLE_ATTRIBUTE, "");
  style.textContent = FREEZE_CSS;
  (doc.head ?? doc.documentElement).appendChild(style);

  let animations: AnimationLike[] = [];
  try {
    animations = animationsToPause(doc.getAnimations?.() ?? [], options.exclude);
  } catch {
    animations = [];
  }
  for (const animation of animations) {
    try {
      animation.pause();
    } catch {
      // Detached or finished; nothing to restore.
    }
  }

  const media = mediaToPause(Array.from(doc.querySelectorAll("video, audio")) as MediaLike[]);
  for (const item of media) item.pause();

  let done = false;
  const unfreeze = () => {
    if (done) return;
    done = true;
    style.remove();
    for (const animation of animations) {
      try {
        if (animation.playState === "paused") animation.play();
      } catch {
        // Animation was cancelled while frozen.
      }
    }
    for (const item of media) {
      if (!item.paused) continue;
      try {
        const result = item.play();
        if (result && typeof result.catch === "function") result.catch(() => {});
      } catch {
        // Autoplay policy may refuse; leave it paused.
      }
    }
  };

  return { animations: animations.length, media: media.length, unfreeze };
}
