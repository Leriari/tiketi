import { api, ApiError } from "../../api";
import { useApiData } from "../../lib/useApiData";
import { useToast } from "../../components/ui/Toast";
import { Card, Toggle, ErrorState, Skeleton } from "../../components/ui";

export default function FeatureFlags() {
  const toast = useToast();
  const { data: flags, setData: setFlags, error, retry } = useApiData(() => api.getFeatureFlags());

  async function toggle(flag) {
    setFlags((cur) => cur.map((f) => (f.id === flag.id ? { ...f, enabled: !f.enabled, rollout_percent: !f.enabled ? f.rollout_percent || 100 : 0 } : f)));
    try {
      await api.toggleFeatureFlag(flag.id);
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Couldn't save that.", { tone: "danger" });
      retry();
    }
  }

  async function setRollout(flag, value) {
    setFlags((cur) => cur.map((f) => (f.id === flag.id ? { ...f, rollout_percent: value, enabled: value > 0 } : f)));
    try {
      await api.updateFeatureFlagRollout({ id: flag.id, rolloutPercent: value });
    } catch (err) {
      toast.push(err instanceof ApiError ? err.message : "Couldn't save that.", { tone: "danger" });
      retry();
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 lg:px-6 py-6 flex flex-col gap-4">
      <div>
        <h1 className="text-h1 text-ink-primary">Feature Flags</h1>
        <p className="text-body-sm text-ink-tertiary">Each switch changes how the live platform behaves, immediately. Rollout turns a flag on for a share of organisations or users. The same ones stay in, so behaviour is stable.</p>
      </div>

      {error ? (
        <ErrorState description={error} onRetry={retry} />
      ) : flags === null ? (
        <div className="flex flex-col gap-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : (
        <div className="flex flex-col gap-3">
          {flags.map((f) => (
            <Card key={f.id} className="flex flex-col gap-3">
              <Toggle label={f.label} hint={f.description} checked={f.enabled} onChange={() => toggle(f)} />
              {f.supports_rollout !== false && <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={f.rollout_percent}
                  onChange={(e) => setRollout(f, Number(e.target.value))}
                  className="flex-1 accent-brand-primary"
                  aria-label={`${f.label} rollout percentage`}
                />
                <span className="text-body-sm text-ink-secondary tabular-nums w-12 text-right">{f.rollout_percent}%</span>
              </div>}
              <p className="text-caption text-ink-tertiary font-mono">{f.key}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
