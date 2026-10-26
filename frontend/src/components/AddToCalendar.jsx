import { CalendarPlus } from "lucide-react";
import { Button, DropdownMenu } from "./ui";
import { downloadIcs, googleCalendarUrl } from "../lib/calendar";

/** event: { event_title, event_date, ends_at?, venue }; ticketId: links back to the ticket. */
export default function AddToCalendar({ event, ticketId, className }) {
  const url = `${window.location.origin}/tickets/${ticketId}`;
  return (
    <DropdownMenu
      placement="bottom-start"
      trigger={
        <Button variant="secondary" iconLeft={<CalendarPlus size={15} />} className={className}>
          Add to calendar
        </Button>
      }
      items={[
        { label: "Google Calendar", onClick: () => window.open(googleCalendarUrl(event, url), "_blank", "noopener") },
        { label: "Apple Calendar or Outlook (.ics)", onClick: () => downloadIcs(event, url, ticketId) },
      ]}
    />
  );
}
