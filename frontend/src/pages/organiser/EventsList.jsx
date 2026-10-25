import { useNavigate } from "react-router-dom";
import { CalendarPlus } from "lucide-react";
import { api } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { Table, Badge, Button, EmptyState, ErrorState } from "../../components/ui";
import EventCover from "../../components/EventCover";
import { formatEventDate } from "../../format";

const STATUS_TONE = { live: "success", draft: "neutral", paused: "warning", sold_out: "info", cancelled: "danger", completed: "neutral" };

/** Every event this organisation runs — the way back into editing one. */
export default function EventsList() {
  const navigate = useNavigate();
  const { data: events, error, retry } = useApiData(() => api.getOrganiserEvents());

  return (
    <div className="mx-auto max-w-6xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-h1 text-ink-primary">Events</h1>
        <Button iconLeft={<CalendarPlus size={15} />} onClick={() => navigate("/organiser/events/new")} className="w-auto px-4">
          Create event
        </Button>
      </div>

      {error && <ErrorState description={error} onRetry={retry} />}

      {!error && (
        <Table
          loading={events === null}
          data={events || []}
          getRowId={(e) => e.id}
          onRowClick={(e) => navigate(`/organiser/events/${e.id}/edit`)}
          empty={
            <EmptyState
              title="No events yet"
              description="Create your first event to start selling tickets."
              actionLabel="Create event"
              onAction={() => navigate("/organiser/events/new")}
            />
          }
          columns={[
            {
              key: "title",
              header: "Event",
              render: (e) => (
                <span className="flex items-center gap-3 min-w-0">
                  <EventCover event={e} className="h-9 w-12 rounded-sm flex-none" />
                  <span className="font-medium text-ink-primary truncate">{e.title}</span>
                </span>
              ),
            },
            { key: "event_date", header: "Date", render: (e) => <span className="tabular-nums">{e.event_date ? formatEventDate(e.event_date) : "—"}</span> },
            { key: "status", header: "Status", render: (e) => (
              e.review_state === "pending" ? <Badge tone="warning">in review</Badge>
                : e.review_state === "rejected" && e.status === "draft" ? <Badge tone="danger">changes requested</Badge>
                  : <Badge tone={STATUS_TONE[e.status] || "neutral"}>{e.status.replace("_", " ")}</Badge>
            ) },
            { key: "tickets_sold", header: "Sold", render: (e) => <span className="tabular-nums">{e.tickets_sold} / {e.total_capacity}</span> },
          ]}
          rowActions={(e) => [
            { label: "Edit event", onClick: () => navigate(`/organiser/events/${e.id}/edit`) },
            { label: "Ticket Central", onClick: () => navigate(`/organiser/tickets?event=${e.id}`) },
            ...(["live", "sold_out"].includes(e.status) ? [{ label: "View public page", onClick: () => navigate(`/events/${e.id}`) }] : []),
          ]}
        />
      )}
    </div>
  );
}
