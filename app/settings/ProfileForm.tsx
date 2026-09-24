"use client";

import { useState } from "react";
import { updateProfile, type Profile } from "@/app/profile/actions";
import AvatarEditor from "./AvatarEditor";
import styles from "@/app/ui.module.css";

export default function ProfileForm({ profile }: { profile: Profile }) {
  const [username, setUsername] = useState(profile.username ?? profile.display_name ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [avatarGrid, setAvatarGrid] = useState<string | null>(profile.avatar_grid ?? null);
  const [isPublic, setIsPublic] = useState(profile.is_public);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ text: string; err?: boolean }>({
    text: "",
  });

  async function save() {
    setSaving(true);
    setStatus({ text: "Saving…" });
    const res = await updateProfile({
      username,
      bio,
      avatar_grid: avatarGrid,
      is_public: isPublic,
    });
    setSaving(false);
    setStatus(
      res.error ? { text: res.error, err: true } : { text: "Saved" },
    );
  }

  return (
    <div>
      <div className={styles.field}>
        <span className={styles.label}>avatar: a 16-step pattern, drawn in the studio&apos;s colours</span>
        <AvatarEditor value={avatarGrid} name={username || "?"} onChange={setAvatarGrid} />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="username">
          name
        </label>
        <input
          className={styles.input}
          id="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="e.g. robotofthefuture"
          autoComplete="off"
        />
        <div className={styles.hintText}>
          {username
            ? `Shown on your songs, and your page is /u/${username}`
            : "2–30 chars: letters, numbers, - and _"}
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="bio">
          bio
        </label>
        <textarea
          className={styles.textarea}
          id="bio"
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          maxLength={500}
        />
      </div>

      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={isPublic}
          onChange={(e) => setIsPublic(e.target.checked)}
        />
        public profile — anyone can view your page
      </label>

      <button
        className={styles.button}
        onClick={save}
        disabled={saving}
        style={{ maxWidth: 200 }}
      >
        {saving ? "Saving…" : "Save profile"}
      </button>

      <div className={`${styles.status} ${status.err ? styles.statusErr : ""}`}>
        {status.text}
      </div>
    </div>
  );
}
