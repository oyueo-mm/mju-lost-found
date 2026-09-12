"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIES, KIND_CONFIG } from "@/lib/constants";
import { campusLocations, locationLabel } from "@/lib/campus";
import { toDateTimeLocalValue } from "@/lib/format";
import { resizeImages } from "@/lib/image-client";
import { useT } from "@/i18n/client";

const MAX = 3;
const box = "field";

export default function PostForm({ kind, campus, action, initial }) {
  const cfg = KIND_CONFIG[kind];
  const router = useRouter();
  const t = useT();
  const [state, formAction, pending] = useActionState(action, null);
  const isEdit = Boolean(initial);
  const locations = campusLocations(campus);

  const initialUrls = Array.isArray(initial?.image_urls)
    ? initial.image_urls
    : initial?.image_url
      ? [initial.image_url]
      : [];
  const [keptUrls, setKeptUrls] = useState(initialUrls);
  const [newFiles, setNewFiles] = useState([]);
  const total = keptUrls.length + newFiles.length;

  async function onPick(e) {
    const picked = Array.from(e.target.files || []).slice(0, MAX - total);
    e.target.value = "";
    if (picked.length === 0) return;
    // 업로드 전에 브라우저에서 축소 (긴 변 1600px) — 용량·로딩 시간 절감
    const files = await resizeImages(picked);
    setNewFiles((prev) => [
      ...prev,
      ...files.map((file) => ({ file, url: URL.createObjectURL(file) })),
    ]);
  }

  return (
    <form action={formAction} className="space-y-3.5">
      <input type="hidden" name="campus" value={campus || ""} />

      <label className="block">
        <span className="mb-1 block text-sm font-medium">{t("form.title")}</span>
        <input
          name="title"
          required
          maxLength={60}
          autoComplete="off"
          defaultValue={initial?.title || ""}
          placeholder={t(kind === "lost" ? "form.titlePhLost" : "form.titlePhFound")}
          className={box}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium">{t("form.desc")}</span>
        <textarea
          name="description"
          required
          rows={5}
          maxLength={2000}
          defaultValue={initial?.description || ""}
          placeholder={t("form.descPh")}
          className={box}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium">{t("form.category")}</span>
        <select
          name="category"
          required
          defaultValue={initial?.category || ""}
          className={box}
        >
          <option value="" disabled>
            {t("form.select")}
          </option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`cat.${c}`)}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium">
          {t("form.location")} <span className="font-normal text-ink-faint">({t("form.building")})</span>
        </span>
        <select
          name="location"
          required
          defaultValue={initial?.location || ""}
          className={box}
        >
          <option value="" disabled>
            {t("form.selectBuilding")}
          </option>
          {locations.map((l) => (
            <option key={l.name} value={l.name}>
              {locationLabel(l)}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium">
          {t("form.detail")} <span className="font-normal text-ink-faint">({t("common.optional")})</span>
        </span>
        <input
          name="location_detail"
          maxLength={80}
          autoComplete="off"
          defaultValue={initial?.location_detail || ""}
          placeholder={t(kind === "lost" ? "form.detailPhLost" : "form.detailPhFound")}
          className={box}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium">{t(kind === "lost" ? "form.lostAt" : "form.foundAt")}</span>
        <input
          type="datetime-local"
          name="at"
          required
          defaultValue={toDateTimeLocalValue(
            initial?.[cfg.dateField] || Date.now(),
          )}
          className={box}
        />
      </label>

      {isEdit && (
        <label className="block">
          <span className="mb-1 block text-sm font-medium">{t("form.status")}</span>
          <select
            name="status"
            defaultValue={initial?.status || cfg.defaultStatus}
            className={box}
          >
            {cfg.statuses.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </label>
      )}

      <div>
        <span className="mb-1 block text-sm font-medium">
          {t("form.photos")} <span className="font-normal text-ink-faint">({t("form.photosHint", { n: MAX })})</span>
        </span>
        {total > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {keptUrls.map((url) => (
              <div key={url} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-20 w-20 rounded-lg object-cover" />
                <input type="hidden" name="keep" value={url} />
                <button
                  type="button"
                  onClick={() => setKeptUrls((p) => p.filter((u) => u !== url))}
                  className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-solid text-[10px] text-white"
                >
                  ✕
                </button>
              </div>
            ))}
            {newFiles.map((nf, i) => (
              <div key={nf.url} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={nf.url} alt="" className="h-20 w-20 rounded-lg object-cover" />
                <button
                  type="button"
                  onClick={() => setNewFiles((p) => p.filter((_, j) => j !== i))}
                  className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-solid text-[10px] text-white"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        {total < MAX && (
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={onPick}
            className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border-0 file:bg-sunken file:px-3 file:py-1.5 file:text-sm file:font-medium"
          />
        )}
        <NewFileInputs files={newFiles} />
      </div>

      {state?.error && (
        <p className="rounded-lg bg-brand-tint px-3 py-2 text-sm text-brand-deep">
          {state.error}
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="btn btn-primary flex-1 py-3"
        >
          {pending ? t("common.saving") : isEdit ? t("form.update") : t("form.submit")}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="btn btn-ghost px-5 py-3"
        >
          {t("common.cancel")}
        </button>
      </div>
    </form>
  );
}

function NewFileInputs({ files }) {
  return (
    <input
      ref={(el) => {
        if (!el) return;
        const dt = new DataTransfer();
        files.forEach((nf) => dt.items.add(nf.file));
        el.files = dt.files;
      }}
      type="file"
      name="image"
      multiple
      hidden
      readOnly
    />
  );
}
