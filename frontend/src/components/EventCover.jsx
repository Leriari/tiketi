import { useState } from "react";
import { cn } from "../lib/cn";
import { categoryGradient } from "../lib/categoryGradient";
import { eventImageUrl } from "../lib/eventImage";

/**
 * An event's cover: the organiser's uploaded image when there is one, over
 * the category gradient that was the only artwork before. The gradient also
 * shows while the image loads and if it fails, so a card never renders
 * blank.
 *
 * event: anything with image_url / image_data_url and category (events,
 *        ticket details, resale listings all qualify)
 * scrim: darken the bottom so white text laid over the image stays readable
 * eager: load immediately (hero images) instead of lazily (card grids)
 * children: overlay content (badges, titles) drawn above the image
 */
export default function EventCover({ event, className, scrim = false, eager = false, children, ...props }) {
  const src = eventImageUrl(event);
  const [failedSrc, setFailedSrc] = useState(null);
  const showImage = src && failedSrc !== src;

  return (
    <div
      className={cn("relative overflow-hidden", className)}
      style={{ background: categoryGradient(event?.category) }}
      {...props}
    >
      {showImage && (
        <img
          src={src}
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          onError={() => setFailedSrc(src)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {showImage && scrim && <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />}
      {children}
    </div>
  );
}
