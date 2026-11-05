/**
 * Bounded recovery for the ONE Vite child owned by the local Desktop Dev
 * supervisor. Installed Native bundles and release pipelines never use it.
 * A stable run resets the crash streak; rapid repeated crashes fail closed.
 */
export function nextLocalViteRestart(failures,uptimeMs) {
  if(!Number.isInteger(failures)||failures<0||
     !Number.isFinite(uptimeMs)||uptimeMs<0)
    throw new TypeError("Invalid Native development restart state");
  const recent=uptimeMs>=60000?0:failures;
  if(recent>=3)return null;
  return Object.freeze({
    failures:recent+1,
    delayMs:Math.min(4000,500*2**recent),
  });
}
