import { useCallback, useId, useRef, useState } from "react";
import { UploadCloud, X, FileWarning } from "lucide-react";
import { cn } from "../../lib/cn";

/**
 * accept: e.g. "image/png,image/jpeg,image/webp"
 * maxSizeMb: rejects larger files with an inline error
 * onFile(file | null)
 */
export default function FileDropzone({ label, accept = "image/png,image/jpeg,image/webp", maxSizeMb = 5, onFile, hint }) {
  const id = useId();
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [error, setError] = useState(null);

  const acceptedTypes = accept.split(",").map((t) => t.trim());

  const handleFile = useCallback(
    (file) => {
      setError(null);
      if (!file) return;
      if (!acceptedTypes.includes(file.type)) {
        setError(`Unsupported file type. Accepted: ${accept.replace(/image\//g, "").toUpperCase()}`);
        return;
      }
      if (file.size > maxSizeMb * 1024 * 1024) {
        setError(`File is too large — max ${maxSizeMb}MB.`);
        return;
      }
      setFileName(file.name);
      setPreview(URL.createObjectURL(file));
      onFile?.(file);
    },
    [acceptedTypes, accept, maxSizeMb, onFile]
  );

  function clear() {
    setPreview(null);
    setFileName(null);
    setError(null);
    onFile?.(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={id} className="text-label uppercase tracking-[0.06em] font-medium text-ink-tertiary">
          {label}
        </label>
      )}

      {preview ? (
        <div className="relative rounded-md border border-line overflow-hidden bg-surface-inset">
          <img src={preview} alt="" className="w-full aspect-square object-cover" />
          <div className="absolute inset-x-0 bottom-0 bg-surface-base/80 backdrop-blur px-3 py-2 flex items-center justify-between gap-2">
            <span className="text-caption text-ink-secondary truncate">{fileName}</span>
            <button type="button" onClick={clear} className="text-ink-tertiary hover:text-danger flex-none" aria-label="Remove file">
              <X size={16} />
            </button>
          </div>
        </div>
      ) : (
        <label
          htmlFor={id}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handleFile(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-6 py-10 text-center cursor-pointer transition-colors duration-150",
            dragging ? "border-brand-primary bg-brand-primary/5" : "border-line-strong bg-surface-inset hover:border-line-strong/80"
          )}
        >
          <UploadCloud size={28} className="text-ink-tertiary" />
          <span className="text-body-sm text-ink-primary font-medium">Drag a file here, or click to browse</span>
          <span className="text-caption text-ink-tertiary">{hint || `${accept.replace(/image\//g, "").toUpperCase()} · up to ${maxSizeMb}MB`}</span>
          <input
            ref={inputRef}
            id={id}
            type="file"
            accept={accept}
            className="sr-only"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </label>
      )}

      {error && (
        <span role="alert" className="flex items-center gap-1.5 text-caption text-danger">
          <FileWarning size={13} /> {error}
        </span>
      )}
    </div>
  );
}
