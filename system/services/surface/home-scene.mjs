// A shared visual day, independent of the light/dark interface preference.
// Uses the configured time zone; does not infer sunrise from geolocation.
export function resolveHomeScene(now, timeZone) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone, hour: "2-digit", hourCycle: "h23",
  }).format(now));
  return Object.freeze({
    period: hour >= 6 && hour < 18 ? "day" : "night",
    greetingId: hour < 6 || hour >= 18 ? "shell.home.greeting.evening"
      : hour < 12 ? "shell.home.greeting.morning" : "shell.home.greeting.afternoon",
  });
}
