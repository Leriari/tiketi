import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "../../lib/cn";

export default function CopyButton({ value, className, label = "Copy" }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? "Copied" : label}
      className={cn("inline-flex items-center gap-1 text-caption text-ink-tertiary hover:text-ink-primary transition-colors duration-150", className)}
    >
      {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
      {copied ? "Copied" : label}
    </button>
  );
}
