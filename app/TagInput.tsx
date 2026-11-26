"use client";

import { useId, useState } from "react";
import { GENRES } from "@/app/songs/genres";
import { TAGS_MAX, TAG_MAX_LEN, normalizeTag, normalizeTags } from "@/lib/songTags.js";
import styles from "@/app/ui.module.css";

// A song's tags as chips and a field: the save box and the songs menu.
//
// A tag is a genre or anything typed. The field suggests the compose panel's
// genres (a native datalist, so it costs no popup of its own inside a popup),
// but nothing is refused for not being one. Enter or a comma ends a tag,
// backspace in an empty field takes the last one back, and what is left in
// the field when it loses focus becomes a tag too, so a save pressed with a
// half-typed tag does not lose it.
const GENRE_NAMES: string[] = [...new Set(GENRES.map((g: { name: string }) => g.name.toLowerCase()))].sort();

export default function TagInput({
  tags,
  onChange,
  disabled = false,
  autoFocus = false,
  placeholder = "genre or tag",
}: {
  tags: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const listId = useId();
  const full = tags.length >= TAGS_MAX;

  const add = (raw: string) => {
    const next = normalizeTags([...tags, ...raw.split(",")]);
    setDraft("");
    if (next.length !== tags.length) onChange(next);
  };

  return (
    <div className={styles.tagBox}>
      {tags.map((t) => (
        <span key={t} className={styles.tagChip}>
          {t}
          <button
            type="button"
            className={styles.tagChipX}
            onClick={() => onChange(tags.filter((x) => x !== t))}
            disabled={disabled}
            aria-label={`remove tag ${t}`}
            title="remove"
          >
            ×
          </button>
        </span>
      ))}
      {!full && (
        <input
          className={styles.tagField}
          list={listId}
          value={draft}
          maxLength={TAG_MAX_LEN + 8}
          placeholder={tags.length ? "add a tag" : placeholder}
          aria-label="add a tag"
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={(e) => {
            const v = e.target.value;
            // A comma ends the tag; so does picking a suggestion, which
            // arrives as one whole value that is a genre's name.
            if (v.includes(",") || (v.length > draft.length + 1 && GENRE_NAMES.includes(normalizeTag(v)))) add(v);
            else setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              e.preventDefault();
              e.stopPropagation();
              add(draft);
            } else if (e.key === "Backspace" && !draft && tags.length) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={() => { if (draft.trim()) add(draft); }}
        />
      )}
      <datalist id={listId}>
        {GENRE_NAMES.filter((g) => !tags.includes(g)).map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
    </div>
  );
}
