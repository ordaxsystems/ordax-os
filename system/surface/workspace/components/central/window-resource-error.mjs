// UI resource diagnostic only. It never supplies credentials or retries commands.
export class WindowResourceLoadError extends Error {
  constructor(cause) {
    super("Window resource could not be loaded", { cause });
    this.name = "WindowResourceLoadError";
  }
}
