"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { ImageOff, Maximize2 } from "lucide-react";

import { loadImageUrl } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/** Session id used to authorise image requests. */
export const SessionContext = createContext<string>("");

type Props = {
  imageId: string;
  alt: string;
  caption?: string;
  className?: string;
  /** Tailwind classes limiting the thumbnail size */
  sizeClassName?: string;
};

/** A session-protected image from the backend, with click-to-enlarge. */
export default function ImageAttachment({
  imageId,
  alt,
  caption,
  className,
  sizeClassName = "max-h-64 max-w-full",
}: Props) {
  const t = useT();
  const sessionId = useContext(SessionContext);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    setLoaded(false);
    loadImageUrl(imageId, sessionId)
      .then((u) => !cancelled && setUrl(u))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [imageId, sessionId]);

  // A cached image can finish decoding before the load handler is attached.
  useEffect(() => {
    if (url && imgRef.current?.complete) setLoaded(true);
  }, [url]);

  if (failed) {
    return (
      <div
        className={cn(
          "flex animate-fade items-center gap-2 rounded-xl border border-dashed border-line bg-fill px-3 py-2.5 text-[13px] text-ink-500",
          className,
        )}
      >
        <ImageOff className="size-4 shrink-0" />
        <span>{t("image_unavailable")}</span>
      </div>
    );
  }

  if (!url) {
    return (
      <div
        className={cn("skeleton h-40 w-56 max-w-full rounded-xl ring-1 ring-line", className)}
        aria-label={t("image_loading")}
      />
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "focus-ring group relative block overflow-hidden rounded-xl bg-black ring-1 ring-line transition-[box-shadow,translate] duration-300 ease-out-quart hover:-translate-y-0.5 hover:shadow-lift hover:ring-white/25",
          className,
        )}
        aria-label={t("image_enlarge", { alt })}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={url}
          alt={alt}
          onLoad={() => setLoaded(true)}
          className={cn(
            "block h-auto w-auto object-contain transition-[opacity,scale] duration-500 ease-out-quart group-hover:scale-[1.03]",
            loaded ? "opacity-100" : "opacity-0",
            sizeClassName,
          )}
        />
        <span className="absolute right-2 top-2 scale-90 rounded-lg bg-black/60 p-1.5 text-white opacity-0 backdrop-blur transition-[opacity,scale] duration-200 ease-out-quart group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100">
          <Maximize2 className="size-3.5" />
        </span>
        {caption && (
          <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-2.5 pb-1.5 pt-5 text-left text-[11px] text-white/90">
            {caption}
          </span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-black p-0 sm:max-w-4xl">
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <DialogDescription className="sr-only">{t("image_enlarged")}</DialogDescription>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={alt} className="max-h-[85dvh] w-full object-contain" />
        </DialogContent>
      </Dialog>
    </>
  );
}
