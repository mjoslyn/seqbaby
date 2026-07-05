"use client";

import { useState } from "react";
import { updateProfile, type Profile } from "@/app/profile/actions";
import styles from "@/app/ui.module.css";

export default function ProfileForm({ profile }: { profile: Profile }) {
  const [username, setUsername] = useState(profile.username ?? "");
  const [displayName, setDisplayName] = useState(profile.display_name ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [avatar, setAvatar] = useState(profile.avatar_url ?? "");
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
      display_name: displayName,
      bio,
      avatar_url: avatar,
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
        <label className={styles.label} htmlFor="username">
          username (your profile URL)
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
            ? `seqbaby.app/u/${username}`
            : "2–30 chars: letters, numbers, - and _"}
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="display">
          display name
        </label>
        <input
          className={styles.input}
          id="display"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
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

      <div className={styles.field}>
        <label className={styles.label} htmlFor="avatar">
          avatar image url (optional)
        </label>
        <input
          className={styles.input}
          id="avatar"
          value={avatar}
          onChange={(e) => setAvatar(e.target.value)}
          placeholder="https://…"
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
