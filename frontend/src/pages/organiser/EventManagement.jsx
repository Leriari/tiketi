import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Plus, X, GripVertical, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import { api, ApiError } from "../../api";
import { useToast } from "../../components/ui/Toast";
import {
  Input, Select, Textarea, DatePicker, FileDropzone, Toggle, RichTextEditor, Chip, Button, Card, MoneyText,
} from "../../components/ui";
import { CATEGORIES } from "../../constants";
import { localInputToUtc, utcToLocalInput } from "../../format";
import { categoryGradient } from "../../lib/categoryGradient";
import { eventImageUrl } from "../../lib/eventImage";

const STATUSES = ["draft", "live", "paused", "sold_out", "cancelled"];
const VISIBILITIES = ["public", "hidden", "password"];

function emptyTier() {
  return { key: crypto.randomUUID(), name: "", description: "", price: "", capacity: "", salesStart: "", salesEnd: "", perOrderMax: 4, visibility: "public" };
}

export default function EventManagement() {
  const { eventId } = useParams();
  const isEdit = Boolean(eventId);
  const navigate = useNavigate();
  const toast = useToast();

  const [loaded, setLoaded] = useState(!isEdit);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [venue, setVenue] = useState("");
  const [artistInput, setArtistInput] = useState("");
  const [artists, setArtists] = useState([]);
  // What the preview shows: the saved image's URL, or a newly picked file
  // as a data: URL. Only a changed image is sent on save (imageChanged),
  // so editing other fields never re-uploads it.
  const [imageDataUrl, setImageDataUrl] = useState(null);
  const [imageChanged, setImageChanged] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("live");
  const [capacity, setCapacity] = useState("");
  const [resaleEnabled, setResaleEnabled] = useState(true);
  const [resaleCapPct, setResaleCapPct] = useState(120);
  const [royaltyPct, setRoyaltyPct] = useState(10);
  const [windowOpenDays, setWindowOpenDays] = useState(0);
  const [windowCloseHours, setWindowCloseHours] = useState(2);
  const [tiers, setTiers] = useState([emptyTier()]);
  const [gates, setGates] = useState([{ key: crypto.randomUUID(), id: undefined, name: "Gate A" }]);

  useEffect(() => {
    if (!isEdit) return;
    api.getOrganiserEvent(eventId).then((ev) => {
      setTitle(ev.title);
      setCategory(ev.category);
      setVenue(ev.venue);
      setArtists(ev.artists || []);
      setImageDataUrl(eventImageUrl(ev));
      setImageChanged(false);
      setStartsAt(utcToLocalInput(ev.event_date));
      setEndsAt(utcToLocalInput(ev.ends_at));
      setDescription(ev.description_html || ev.description || "");
      setStatus(ev.status);
      setCapacity(String(ev.total_capacity));
      setResaleEnabled(ev.resale_enabled);
      setResaleCapPct(Math.round(ev.resale_ceiling_multiplier * 100));
      setRoyaltyPct(ev.resale_royalty_percent);
      setWindowOpenDays(ev.resale_window_open_days);
      setWindowCloseHours(ev.resale_window_close_hours);
      setTiers(ev.tiers.map((t) => ({
        key: crypto.randomUUID(), ...t, price: String(t.price), capacity: String(t.capacity),
        salesStart: utcToLocalInput(t.salesStart, false), salesEnd: utcToLocalInput(t.salesEnd, false),
      })));
      setGates(ev.gates.map((g) => ({ key: crypto.randomUUID(), ...g })));
      setLoaded(true);
    }).catch((err) => {
      toast.push(err instanceof ApiError ? err.message : "Couldn't load this event.", { tone: "danger" });
      navigate("/organiser", { replace: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, isEdit]);

  function markDirty(setter) {
    return (...args) => { setDirty(true); setter(...args); };
  }

  // Full in-app route-change interception needs a data router (createBrowserRouter
  // + useBlocker), which this app doesn't use — this guards the two ways someone
  // actually leaves an unsaved form here: closing/refreshing the tab, and this
  // page's own Back button. Sidebar nav-away isn't intercepted; a known gap.
  useEffect(() => {
    function onBeforeUnload(e) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function handleBack() {
    if (dirty && !window.confirm("You have unsaved changes. Leave this page anyway?")) return;
    // Always the events list — navigate(-1) left the app when the page was
    // opened directly or in a new tab.
    navigate("/organiser/events");
  }

  function addArtist(e) {
    e.preventDefault();
    if (!artistInput.trim()) return;
    setArtists((a) => [...a, artistInput.trim()]);
    setArtistInput("");
    setDirty(true);
  }

  function updateTier(key, field, value) {
    setDirty(true);
    setTiers((rows) => rows.map((t) => (t.key === key ? { ...t, [field]: value } : t)));
  }
  function moveTier(index, dir) {
    setDirty(true);
    setTiers((rows) => {
      const next = [...rows];
      const j = index + dir;
      if (j < 0 || j >= next.length) return rows;
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }
  function removeTier(key) {
    setDirty(true);
    setTiers((rows) => (rows.length > 1 ? rows.filter((t) => t.key !== key) : rows));
  }

  function buildPayload(nextStatus) {
    return {
      title,
      category,
      venue,
      artists,
      ...(imageChanged ? { image_data_url: imageDataUrl } : {}),
      // The inputs hold the organiser's own clock; the API stores UTC.
      event_date: localInputToUtc(startsAt),
      ends_at: localInputToUtc(endsAt),
      description,
      description_html: description,
      status: nextStatus,
      total_capacity: capacity || tiers.reduce((s, t) => s + Number(t.capacity || 0), 0),
      max_resale_multiplier: resaleCapPct / 100,
      resale_royalty_percent: Number(royaltyPct),
      resale_enabled: resaleEnabled,
      resale_window_open_days: windowOpenDays,
      resale_window_close_hours: windowCloseHours,
      tiers: tiers.map((t) => ({
        ...t, price: Number(t.price), capacity: Number(t.capacity),
        salesStart: localInputToUtc(t.salesStart), salesEnd: localInputToUtc(t.salesEnd),
      })),
      gates: gates.map((g) => ({ id: g.id, name: g.name })),
    };
  }

  function validationErrors() {
    const missing = [];
    if (!title.trim()) missing.push("a title");
    if (!venue.trim()) missing.push("a venue");
    if (!startsAt) missing.push("a start date");
    if (!tiers.some((t) => t.name.trim() && Number(t.price) >= 0 && Number(t.capacity) > 0)) missing.push("at least one ticket tier with a name, price, and capacity");
    return missing;
  }

  async function save(nextStatus) {
    // Drafts can be incomplete by definition — only block publishing.
    if (nextStatus !== "draft") {
      const missing = validationErrors();
      if (missing.length) {
        toast.push(`Add ${missing.join(", ")} before publishing.`, { tone: "danger" });
        return;
      }
    }
    setBusy(true);
    try {
      const payload = buildPayload(nextStatus);
      const result = isEdit ? await api.updateEvent(eventId, payload) : await api.createEvent(payload);
      setDirty(false);
      setImageChanged(false);
      toast.push(isEdit ? "Event updated." : "Event published.", { tone: "success" });
      navigate(`/organiser/events/${result.id}/edit`, { replace: true });
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Couldn't save this event.", { tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;

  const preview = { title, venue, event_date: startsAt, category };

  return (
    <div className="mx-auto max-w-6xl px-4 lg:px-6 py-6">
      <nav aria-label="Breadcrumb" className="text-body-sm text-ink-tertiary mb-1">
        <Link to="/organiser/events" className="hover:text-ink-primary">Events</Link>
        <span aria-hidden="true"> / </span>
        <span className="text-ink-secondary">{isEdit ? title || "Edit" : "New event"}</span>
      </nav>
      <h1 className="text-h1 text-ink-primary mb-6">{isEdit ? "Edit event" : "Create an event"}</h1>

      <div className="grid lg:grid-cols-[300px_1fr] gap-8">
        {/* Live preview */}
        <div className="lg:sticky lg:top-24 h-fit">
          <Card padding="p-0" className="overflow-hidden">
            <div className="aspect-[4/5] flex items-end p-4" style={{ background: imageDataUrl ? `url(${imageDataUrl}) center/cover` : categoryGradient(category) }}>
              <div className="text-white">
                <p className="text-caption uppercase tracking-wide opacity-80">{category}</p>
                <p className="text-h3 font-bold">{title || "Untitled event"}</p>
              </div>
            </div>
            <div className="p-3 flex flex-col gap-0.5 text-body-sm">
              <p className={venue ? "text-ink-primary" : "text-ink-faint text-ink-tertiary italic"}>{venue || "Venue TBC"}</p>
              <p className={startsAt ? "text-ink-primary" : "text-ink-tertiary italic"}>
                {startsAt ? new Date(startsAt).toLocaleString("en-KE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Date TBC"}
              </p>
              <p className={artists.length ? "text-ink-primary" : "text-ink-tertiary italic"}>{artists.length ? artists.join(", ") : "Artist TBC"}</p>
            </div>
          </Card>
        </div>

        {/* Form */}
        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-4">
            <Input label="Title" required value={title} onChange={(e) => markDirty(setTitle)(e.target.value)} />
            <div className="grid sm:grid-cols-2 gap-4">
              <Input label="Venue" value={venue} onChange={(e) => markDirty(setVenue)(e.target.value)} />
              <Select label="Category" value={category} onChange={(e) => markDirty(setCategory)(e.target.value)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-label uppercase tracking-[0.06em] font-medium text-ink-tertiary">Artists / Lineup</label>
              <div className="flex flex-wrap gap-1.5 mb-1">
                {artists.map((a, i) => (
                  <Chip key={a + i} onRemove={() => markDirty(setArtists)(artists.filter((_, idx) => idx !== i))}>{a}</Chip>
                ))}
              </div>
              <form onSubmit={addArtist} className="flex gap-2">
                <input
                  value={artistInput}
                  onChange={(e) => setArtistInput(e.target.value)}
                  placeholder="Add an artist, press Enter"
                  className="flex-1 h-10 rounded-sm bg-surface-inset border border-line px-3 text-body text-ink-primary focus:outline-none focus:ring-2 focus:ring-brand-primary"
                />
                <Button type="submit" variant="secondary" iconOnly aria-label="Add artist"><Plus size={16} /></Button>
              </form>
            </div>

            <FileDropzone
              label="Event Image"
              value={imageDataUrl && !imageDataUrl.startsWith("data:") ? imageDataUrl : null}
              onFile={(f) => {
                setDirty(true);
                setImageChanged(true);
                if (!f) return setImageDataUrl(null);
                const reader = new FileReader();
                reader.onload = () => setImageDataUrl(reader.result);
                reader.readAsDataURL(f);
              }}
              hint="PNG, JPEG, WEBP — 1:1 recommended, up to 5MB"
            />

            <div className="grid sm:grid-cols-2 gap-4">
              <DatePicker label="Starts" withTime required value={startsAt} onChange={(e) => markDirty(setStartsAt)(e.target.value)} />
              <DatePicker label="Ends" withTime value={endsAt} onChange={(e) => markDirty(setEndsAt)(e.target.value)} />
            </div>

            <RichTextEditor label="Description" value={description} onChange={markDirty(setDescription)} />

            <div className="grid sm:grid-cols-2 gap-4">
              <Select label="Event Status" value={status} onChange={(e) => markDirty(setStatus)(e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </Select>
              <Input label="Capacity (total tickets)" type="number" value={capacity} onChange={(e) => markDirty(setCapacity)(e.target.value)} placeholder="Auto from tiers if left blank" />
            </div>
          </section>

          <section className="flex flex-col gap-4 border-t border-line-subtle pt-6">
            <Toggle checked={resaleEnabled} onChange={markDirty(setResaleEnabled)} label="Enable Resale" hint="Allow ticket buyers to resell their tickets on ChainTix." />
            {resaleEnabled && (
              <div className="grid sm:grid-cols-2 gap-4 pl-1">
                <div className="flex flex-col gap-1.5">
                  <label className="text-label uppercase tracking-[0.06em] font-medium text-ink-tertiary">Maximum resale price</label>
                  <input type="range" aria-label="Maximum resale price" min={100} max={200} value={resaleCapPct} onChange={(e) => markDirty(setResaleCapPct)(Number(e.target.value))} className="accent-brand-primary" />
                  <span className="text-caption text-ink-secondary tabular-nums">{resaleCapPct}% of face value</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-label uppercase tracking-[0.06em] font-medium text-ink-tertiary">Organiser royalty</label>
                  <input type="range" aria-label="Organiser royalty" min={0} max={30} value={royaltyPct} onChange={(e) => markDirty(setRoyaltyPct)(Number(e.target.value))} className="accent-brand-primary" />
                  <span className="text-caption text-ink-secondary tabular-nums">{royaltyPct}%</span>
                </div>
                <Input label="Resale opens (days after sale)" type="number" min={0} value={windowOpenDays} onChange={(e) => markDirty(setWindowOpenDays)(Number(e.target.value))} />
                <Input label="Resale closes (hours before event)" type="number" min={0} value={windowCloseHours} onChange={(e) => markDirty(setWindowCloseHours)(Number(e.target.value))} />
                <p className="sm:col-span-2 text-caption text-ink-tertiary">Once the event goes live these values are written to the smart contract and cannot be increased.</p>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-3 border-t border-line-subtle pt-6">
            <span className="text-label uppercase tracking-[0.06em] font-medium text-ink-tertiary">Ticket Categories</span>
            {tiers.length === 0 && <p className="text-body-sm text-ink-tertiary">No categories yet. Add a category like "General Access" or "VIP" to get started.</p>}
            <div className="flex flex-col gap-3">
              {tiers.map((t, i) => (
                <Card key={t.key} className="flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <GripVertical size={14} className="text-ink-faint text-ink-tertiary flex-none" />
                    <Input aria-label="Name" value={t.name} onChange={(e) => updateTier(t.key, "name", e.target.value)} placeholder="Tier name" className="flex-1" />
                    <button type="button" aria-label="Move tier up" onClick={() => moveTier(i, -1)} disabled={i === 0} className="text-ink-tertiary disabled:opacity-30"><ArrowUp size={15} /></button>
                    <button type="button" aria-label="Move tier down" onClick={() => moveTier(i, 1)} disabled={i === tiers.length - 1} className="text-ink-tertiary disabled:opacity-30"><ArrowDown size={15} /></button>
                    <button type="button" aria-label="Remove tier" onClick={() => removeTier(t.key)} className="text-danger"><Trash2 size={15} /></button>
                  </div>
                  <Textarea rows={2} value={t.description} onChange={(e) => updateTier(t.key, "description", e.target.value)} placeholder="Description" />
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Input label="Price (KES)" type="number" value={t.price} onChange={(e) => updateTier(t.key, "price", e.target.value)} />
                    <Input label="Quantity" type="number" value={t.capacity} onChange={(e) => updateTier(t.key, "capacity", e.target.value)} />
                    <Input label="Per-order max" type="number" value={t.perOrderMax} onChange={(e) => updateTier(t.key, "perOrderMax", e.target.value)} />
                    <Select label="Visibility" value={t.visibility} onChange={(e) => updateTier(t.key, "visibility", e.target.value)}>
                      {VISIBILITIES.map((v) => <option key={v} value={v}>{v}</option>)}
                    </Select>
                    <DatePicker label="Sales start" value={t.salesStart || ""} onChange={(e) => updateTier(t.key, "salesStart", e.target.value)} />
                    <DatePicker label="Sales end" value={t.salesEnd || ""} onChange={(e) => updateTier(t.key, "salesEnd", e.target.value)} />
                  </div>
                </Card>
              ))}
            </div>
            <Button variant="secondary" size="sm" iconLeft={<Plus size={14} />} onClick={() => { setDirty(true); setTiers((r) => [...r, emptyTier()]); }} className="w-auto self-start px-4">
              Add Category
            </Button>
          </section>

          <section className="flex flex-col gap-3 border-t border-line-subtle pt-6">
            <span className="text-label uppercase tracking-[0.06em] font-medium text-ink-tertiary">Gate Configuration</span>
            <div className="flex flex-col gap-2">
              {gates.map((g, i) => (
                <div key={g.key} className="flex items-center gap-2">
                  <Input aria-label="Gate name" value={g.name} onChange={(e) => { setDirty(true); setGates((rows) => rows.map((r) => (r.key === g.key ? { ...r, name: e.target.value } : r))); }} className="flex-1" />
                  <button type="button" aria-label="Remove gate" onClick={() => { setDirty(true); setGates((rows) => rows.length > 1 ? rows.filter((r) => r.key !== g.key) : rows); }} className="text-danger"><X size={15} /></button>
                </div>
              ))}
            </div>
            <Button variant="secondary" size="sm" iconLeft={<Plus size={14} />} onClick={() => { setDirty(true); setGates((r) => [...r, { key: crypto.randomUUID(), name: `Gate ${String.fromCharCode(65 + r.length)}` }]); }} className="w-auto self-start px-4">
              Add Gate
            </Button>
          </section>

          <div className="flex items-center justify-between border-t border-line-subtle pt-6 pb-10">
            <Button variant="ghost" onClick={handleBack}>Back</Button>
            <div className="flex gap-2">
              <Button variant="secondary" loading={busy} onClick={() => save("draft")}>Save as Draft</Button>
              <Button variant="primary" loading={busy} onClick={() => save(status === "draft" ? "live" : status)}>Save Event</Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
