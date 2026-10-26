// "Add to calendar" for an event: a Google Calendar link, and an .ics file
// for everything else (Apple Calendar, Outlook). Times come from the API in
// UTC; both formats carry UTC, so each calendar shows the person's own time.

const DEFAULT_LENGTH_MS = 3 * 60 * 60 * 1000; // when the organiser gave no end time

function stamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); // 20261128T110000Z
}

function span(event) {
  const start = new Date(event.event_date);
  const end = event.ends_at ? new Date(event.ends_at) : new Date(start.getTime() + DEFAULT_LENGTH_MS);
  return { start, end };
}

function details(event, url) {
  return [`Your ChainTix ticket: ${url}`, "Show the QR code in the ChainTix app at the gate."].join("\n");
}

/** event: { event_title | title, event_date, ends_at?, venue }; url: the ticket's page. */
export function googleCalendarUrl(event, url) {
  const { start, end } = span(event);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.event_title || event.title,
    dates: `${stamp(start)}/${stamp(end)}`,
    location: event.venue || "",
    details: details(event, url),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

function icsText(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => `\\${c}`);
}

/** Downloads an .ics file for the event. */
export function downloadIcs(event, url, uid) {
  const { start, end } = span(event);
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ChainTix//Tickets//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}@chaintix`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${icsText(event.event_title || event.title)}`,
    `LOCATION:${icsText(event.venue)}`,
    `DESCRIPTION:${icsText(details(event, url))}`,
    `URL:${url}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT3H",
    "ACTION:DISPLAY",
    "DESCRIPTION:Event starts in 3 hours: have your ChainTix ticket ready",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `${(event.event_title || event.title || "event").replace(/[^\w]+/g, "-").toLowerCase()}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
