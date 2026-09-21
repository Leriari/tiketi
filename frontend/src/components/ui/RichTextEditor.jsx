import { useEffect, useId, useRef } from "react";
import { Bold, Italic, List, Link2 } from "lucide-react";
import { cn } from "../../lib/cn";

const TOOLBAR = [
  { cmd: "bold", icon: Bold, label: "Bold" },
  { cmd: "italic", icon: Italic, label: "Italic" },
  { cmd: "insertUnorderedList", icon: List, label: "Bulleted list" },
  { cmd: "createLink", icon: Link2, label: "Link", prompt: "Paste a URL" },
];

/**
 * Minimal contentEditable rich text field — spec §5.2 asks for "bold, italic,
 * lists, links" on the event description, nothing more elaborate. Uses
 * document.execCommand, which is deprecated but still broadly functional in
 * Chromium for exactly this scope; a heavier editor library buys nothing here.
 */
export default function RichTextEditor({ label, value, onChange, hint }) {
  const id = useId();
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== (value || "")) {
      ref.current.innerHTML = value || "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function exec(cmd, needsPrompt) {
    ref.current?.focus();
    if (needsPrompt) {
      const url = window.prompt("Paste a URL");
      if (!url) return;
      document.execCommand(cmd, false, url);
    } else {
      document.execCommand(cmd, false);
    }
    onChange(ref.current.innerHTML);
  }

  return (
    <div className="flex flex-col gap-1.5">
      {label && <label htmlFor={id} className="text-label uppercase tracking-[0.06em] font-medium text-ink-tertiary">{label}</label>}
      <div className="rounded-sm border border-line bg-surface-inset overflow-hidden">
        <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
          {TOOLBAR.map((t) => (
            <button
              key={t.cmd}
              type="button"
              title={t.label}
              onClick={() => exec(t.cmd, t.prompt)}
              className="flex h-7 w-7 items-center justify-center rounded-sm text-ink-secondary hover:bg-surface-elevated hover:text-ink-primary"
            >
              <t.icon size={14} />
            </button>
          ))}
        </div>
        <div
          id={id}
          ref={ref}
          contentEditable
          onInput={(e) => onChange(e.currentTarget.innerHTML)}
          className={cn(
            "min-h-[120px] px-3 py-2.5 text-body text-ink-primary focus:outline-none",
            "[&_ul]:list-disc [&_ul]:pl-5 [&_a]:text-brand-primary-on-tint [&_a]:underline"
          )}
        />
      </div>
      {hint && <span className="text-caption text-ink-tertiary">{hint}</span>}
    </div>
  );
}
