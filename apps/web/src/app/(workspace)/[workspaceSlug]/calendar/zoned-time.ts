function formatter(
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, ...options });
  } catch {
    return new Intl.DateTimeFormat("en-US", options);
  }
}

export function dateKeyInZone(date: Date, timeZone: string) {
  const parts = formatter(timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function timeInZone(date: Date, timeZone: string) {
  return formatter(timeZone, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function fullDateTimeInZone(date: Date, timeZone: string) {
  return formatter(timeZone, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function zonedWallTimeToUtc(
  dateValue: string,
  timeValue: string,
  timeZone: string,
) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  let timestamp = Date.UTC(year, month - 1, day, hour, minute);

  for (let index = 0; index < 3; index += 1) {
    const parts = formatter(timeZone, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(timestamp));
    const value = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );
    const rendered = Date.UTC(
      Number(value.year),
      Number(value.month) - 1,
      Number(value.day),
      Number(value.hour),
      Number(value.minute),
    );
    timestamp -= rendered - Date.UTC(year, month - 1, day, hour, minute);
  }

  return new Date(timestamp);
}
