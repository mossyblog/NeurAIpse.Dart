/** Stack-trace parsing for React 19 `_debugStack` owner stacks. Pure, no DOM. */

export type StackFrame = {
  /** Function name without `Object.` / `exports.` / `async ` prefixes; "" when anonymous. */
  fn: string;
  url: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
};

const CHROME_FRAME = /^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/;
const FIREFOX_FRAME = /^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/;

/** The function name as written in source: drops receiver prefixes and `async`. */
export function cleanFunctionName(raw: string): string {
  let name = raw.trim().replace(/^async\s+/, "").replace(/^new\s+/, "");
  // "Object.Button", "exports.jsxDEV", "Module.Foo" -> last member
  if (/^[\w$]+(\.[\w$]+)+$/.test(name)) name = name.slice(name.lastIndexOf(".") + 1);
  // "Button [as render]" -> "Button"
  name = name.replace(/\s*\[as [^\]]+\]$/, "");
  return name;
}

/** Parses V8 (`at fn (url:l:c)`) and SpiderMonkey/JSC (`fn@url:l:c`) frames; skips other lines. */
export function parseStack(stack: string): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const line of stack.split("\n")) {
    const match = CHROME_FRAME.exec(line) ?? (line.includes("@") ? FIREFOX_FRAME.exec(line) : null);
    if (!match) continue;
    const [, fn = "", url, l, c] = match;
    frames.push({ fn: cleanFunctionName(fn), url, line: Number(l), column: Number(c) });
  }
  return frames;
}

/** JSX factories and React plumbing that sit above the real call site in an owner stack. */
const FACTORY = /^(jsx|jsxs|jsxDEV|createElement|cloneElement|fakeJSXCallSite)$/;
const BOTTOM = /^react_stack_bottom_frame$/;

/** Frames below the JSX factory, stopping at React's bottom marker. */
export function callSiteFrames(frames: readonly StackFrame[]): StackFrame[] {
  let start = 0;
  while (start < frames.length && FACTORY.test(frames[start].fn)) start += 1;
  const result: StackFrame[] = [];
  for (let i = start; i < frames.length; i += 1) {
    if (BOTTOM.test(frames[i].fn)) break;
    result.push(frames[i]);
  }
  return result;
}

/** PascalCase identifiers are treated as component render functions. */
export function isComponentName(name: string): boolean {
  return /^[A-Z][\w$]*$/.test(name);
}

/** First call-site frame that belongs to the named function (the owner's render). */
export function frameForFunction(frames: readonly StackFrame[], name: string): StackFrame | null {
  return callSiteFrames(frames).find((frame) => frame.fn === name) ?? null;
}

/** The nearest call site inside a component render (helpers like `slotRender` are skipped). */
export function componentCallSite(frames: readonly StackFrame[]): StackFrame | null {
  return callSiteFrames(frames).find((frame) => isComponentName(frame.fn)) ?? null;
}
