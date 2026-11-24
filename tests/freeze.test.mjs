import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  FREEZE_CSS,
  FREEZE_STYLE_ATTRIBUTE,
  animationsToPause,
  freezePage,
  isCssAnimation,
  mediaToPause,
} from "../dist/core/index.js";

function fakeAnimation(playState, extra = {}) {
  const calls = [];
  return {
    playState,
    calls,
    pause() {
      calls.push("pause");
      this.playState = "paused";
    },
    play() {
      calls.push("play");
      this.playState = "running";
    },
    ...extra,
  };
}

function fakeMedia(paused, ended = false) {
  const calls = [];
  return {
    paused,
    ended,
    calls,
    pause() {
      calls.push("pause");
      this.paused = true;
    },
    play() {
      calls.push("play");
      this.paused = false;
      return Promise.resolve();
    },
  };
}

function fakeDocument(animations, media) {
  const head = { children: [], appendChild(node) { this.children.push(node); node.parent = this; } };
  return {
    head,
    documentElement: head,
    getAnimations: () => animations,
    querySelectorAll: (selector) => {
      assert.equal(selector, "video, audio");
      return media;
    },
    createElement: (tag) => {
      assert.equal(tag, "style");
      const node = {
        attributes: {},
        textContent: null,
        setAttribute(name, value) { this.attributes[name] = value; },
        remove() { head.children = head.children.filter((child) => child !== node); },
      };
      return node;
    },
  };
}

test("freeze injects a tagged style that pauses CSS animations", () => {
  // INTENTION: CSS animations are paused by a style tag (not their API), and the tag is
  // marked so the overlay's style mirror can skip it and keep animating itself.
  const doc = fakeDocument([], []);
  const { unfreeze } = freezePage(doc);
  assert.equal(doc.head.children.length, 1);
  const [style] = doc.head.children;
  assert.equal(style.attributes[FREEZE_STYLE_ATTRIBUTE], "");
  assert.equal(style.textContent, FREEZE_CSS);
  assert.match(FREEZE_CSS, /animation-play-state: paused !important/);
  unfreeze();
  assert.equal(doc.head.children.length, 0);
});

test("only running, non-CSS, non-overlay Web Animations are paused", () => {
  // INTENTION: freeze must not touch CSS animations (the style tag owns them), animations
  // the author already paused or finished, or the toolbar's own animations.
  const overlay = { id: "overlay" };
  const running = fakeAnimation("running");
  const css = fakeAnimation("running", { animationName: "spin" });
  const paused = fakeAnimation("paused");
  const finished = fakeAnimation("finished");
  const own = fakeAnimation("running", { effect: { target: overlay } });
  assert.equal(isCssAnimation(css), true);
  assert.deepEqual(
    animationsToPause([running, css, paused, finished, own], (target) => target === overlay),
    [running],
  );
});

test("only playing media is paused", () => {
  // INTENTION: already-paused or ended media keeps its state across freeze/unfreeze.
  const playing = fakeMedia(false);
  assert.deepEqual(mediaToPause([playing, fakeMedia(true), fakeMedia(false, true)]), [playing]);
});

test("unfreeze restores exactly what freeze paused", () => {
  // INTENTION: resume restores prior play state: running things resume, things that were
  // paused before freeze stay paused, and unfreeze is idempotent.
  const running = fakeAnimation("running");
  const authorPaused = fakeAnimation("paused");
  const playing = fakeMedia(false);
  const stopped = fakeMedia(true);
  const doc = fakeDocument([running, authorPaused], [playing, stopped]);
  const result = freezePage(doc);
  assert.deepEqual([result.animations, result.media], [1, 1]);
  assert.equal(running.playState, "paused");
  assert.equal(playing.paused, true);
  result.unfreeze();
  result.unfreeze();
  assert.deepEqual(running.calls, ["pause", "play"]);
  assert.deepEqual(authorPaused.calls, []);
  assert.deepEqual(playing.calls, ["pause", "play"]);
  assert.deepEqual(stopped.calls, []);
});

test("unfreeze does not resume an animation that was cancelled or finished while frozen", () => {
  // INTENTION: something the page changed during freeze is left as the page set it.
  const running = fakeAnimation("running");
  const doc = fakeDocument([running], []);
  const { unfreeze } = freezePage(doc);
  running.playState = "idle";
  unfreeze();
  assert.deepEqual(running.calls, ["pause"]);
});

test("freeze tolerates documents without getAnimations", () => {
  // INTENTION: older engines without document.getAnimations still pause CSS and media.
  const doc = fakeDocument([], []);
  delete doc.getAnimations;
  const result = freezePage(doc);
  assert.equal(result.animations, 0);
  result.unfreeze();
});
