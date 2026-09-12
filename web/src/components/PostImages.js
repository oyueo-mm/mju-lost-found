"use client";

import { useState } from "react";
import ImageViewer from "./ImageViewer";

export default function PostImages({ images }) {
  const [open, setOpen] = useState(-1);
  if (!images || images.length === 0) return null;

  const one = images.length === 1;

  return (
    <>
      <div
        className={
          one
            ? ""
            : "grid gap-2 " +
              (images.length === 2 ? "grid-cols-2" : "grid-cols-3")
        }
      >
        {images.map((url, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setOpen(i)}
            className={
              one
                ? "block w-full overflow-hidden rounded-xl border border-line bg-sunken"
                : "block aspect-square overflow-hidden rounded-xl border border-line bg-sunken"
            }
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt=""
              className={
                one
                  ? "max-h-96 w-full object-contain"
                  : "h-full w-full object-cover transition hover:opacity-90"
              }
            />
          </button>
        ))}
      </div>

      {open >= 0 && (
        <ImageViewer
          images={images}
          start={open}
          onClose={() => setOpen(-1)}
        />
      )}
    </>
  );
}
