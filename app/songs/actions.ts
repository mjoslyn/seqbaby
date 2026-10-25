"use server";

import { cfEnv } from "@/lib/cf";
import { currentUserId } from "@/lib/auth/session";
import * as songs from "@/lib/data/songs.js";

// The studio's song endpoints. Each is a server action, so each is reachable
// by anyone who can POST to the site: who is asking is resolved here, from the
// session cookie, and handed to lib/data/songs.js, which is where every rule
// about what that person may read or write is applied (the job Row Level
// Security did when this was Supabase).

export type SongListItem = {
  id: string;
  title: string;
  updated_at: string;
  is_public: boolean;
  share_slug: string | null;
  current_version_id: string | null;
  /** A starting point rather than a work in progress: saving while one is open
   *  makes a new song instead of a new version of it. */
  is_template: boolean;
  /** The one template a new session starts from. At most one per account. */
  is_default_template: boolean;
  /** The step preview (app/songs/songPreview.js), written with the song. */
  preview?: unknown;
};

/** A node of a song's version tree. Never carries `data` -- the list is drawn
 *  for every song in the menu, and the blobs are the whole session each. */
export type SongVersion = {
  id: string;
  parent_id: string | null;
  seq: number;
  label: string | null;
  created_at: string;
};

async function who() {
  const [env, userId] = await Promise.all([cfEnv(), currentUserId()]);
  return { env, userId };
}

/** Save the current song. Insert when no id, update in place when id is owned.
 *  Either way a version is appended off `parentVersionId` (default: the tip). */
export async function saveSong(input: {
  id?: string;
  title: string;
  data: unknown;
  parentVersionId?: string | null;
  /** The title was generated for an unnamed song rather than typed. */
  titleGenerated?: boolean;
  /** The studio is holding a TEMPLATE: this save starts a new song off it
   *  rather than appending a version to it. The id is the template's. */
  fromTemplateId?: string | null;
  /** What to call the version this save appends ("compose" for the compose
   *  panel's autosave). */
  label?: string | null;
}): Promise<{
  id?: string;
  title?: string;
  versionId?: string;
  versionSeq?: number;
  unchanged?: boolean;
  error?: string;
}> {
  const { env, userId } = await who();
  return songs.saveSong(env, userId, input);
}

/** Remix a public (or owned) song into the current user's account. */
export async function remixSong(
  sourceId: string,
  sourceVersionId?: string,
): Promise<{ id?: string; title?: string; versionId?: string; error?: string }> {
  const { env, userId } = await who();
  return songs.remixSong(env, userId, sourceId, sourceVersionId);
}

/** Save under a name, public or not; returns the share slug when public. */
export async function saveNamedSong(input: {
  title: string;
  data: unknown;
  isPublic: boolean;
  parentVersionId?: string | null;
  titleGenerated?: boolean;
  fromTemplateId?: string | null;
}): Promise<{
  id?: string;
  title?: string;
  slug?: string;
  versionId?: string;
  versionSeq?: number;
  unchanged?: boolean;
  error?: string;
}> {
  const { env, userId } = await who();
  return songs.saveNamedSong(env, userId, input);
}

export async function listSongs(): Promise<{ songs: SongListItem[]; error?: string }> {
  const { env, userId } = await who();
  return songs.listSongs(env, userId);
}

/** A song's data: the owner's, or anyone's if it is public. */
export async function loadSong(id: string): Promise<{
  title?: string;
  data?: unknown;
  versionId?: string | null;
  owned?: boolean;
  isTemplate?: boolean;
  error?: string;
}> {
  const { env, userId } = await who();
  return songs.loadSong(env, userId, id);
}

// ---- templates ---------------------------------------------------------

export async function setSongTemplate(id: string, isTemplate: boolean): Promise<{ ok?: boolean; error?: string }> {
  const { env, userId } = await who();
  return songs.setSongTemplate(env, userId, id, isTemplate);
}

export async function setDefaultTemplate(id: string | null): Promise<{ ok?: boolean; error?: string }> {
  const { env, userId } = await who();
  return songs.setDefaultTemplate(env, userId, id);
}

/** The default template's session blob, for a studio about to start a new song. */
export type DefaultTemplate = {
  id: string;
  title: string;
  data: unknown;
  versionId: string | null;
};

export async function getDefaultTemplate(): Promise<{ template?: DefaultTemplate | null; error?: string }> {
  try {
    const { env, userId } = await who();
    return await songs.getDefaultTemplate(env, userId);
  } catch (e) {
    return { template: null, error: String((e as Error)?.message ?? e) };
  }
}

// ---- versions -----------------------------------------------------------

export async function getVersionSeq(versionId: string): Promise<{ seq?: number; error?: string }> {
  const { env, userId } = await who();
  return songs.getVersionSeq(env, userId, versionId);
}

export async function listVersions(
  songId: string,
): Promise<{ versions: SongVersion[]; currentId?: string | null; error?: string }> {
  const { env, userId } = await who();
  return songs.listVersions(env, userId, songId);
}

export async function loadVersion(versionId: string): Promise<{
  songId?: string;
  title?: string;
  seq?: number;
  data?: unknown;
  error?: string;
}> {
  const { env, userId } = await who();
  return songs.loadVersion(env, userId, versionId);
}

export async function labelVersion(versionId: string, label: string): Promise<{ ok?: boolean; error?: string }> {
  const { env, userId } = await who();
  return songs.labelVersion(env, userId, versionId, label);
}

export async function deleteVersion(versionId: string): Promise<{ ok?: boolean; error?: string }> {
  const { env, userId } = await who();
  return songs.deleteVersion(env, userId, versionId);
}

export async function renameSong(id: string, title: string): Promise<{ ok?: boolean; error?: string }> {
  const { env, userId } = await who();
  return songs.renameSong(env, userId, id, title);
}

export async function deleteSong(id: string): Promise<{ ok?: boolean; error?: string }> {
  const { env, userId } = await who();
  return songs.deleteSong(env, userId, id);
}

export async function publishSong(id: string): Promise<{ slug?: string; error?: string }> {
  const { env, userId } = await who();
  return songs.publishSong(env, userId, id);
}

export async function unpublishSong(id: string): Promise<{ ok?: boolean; error?: string }> {
  const { env, userId } = await who();
  return songs.unpublishSong(env, userId, id);
}

/** A turn of the compose conversation, as the panel holds it. */
export type ChatTurn = {
  role: "user" | "assistant" | "error";
  text: string;
  /** Which model wrote the turn, when the panel offered a choice. */
  model?: string;
  activity?: string[];
  warnings?: string[];
};

// The compose chat is attached to the SONG, so opening a song a week later
// brings back what was said to build it.

export async function loadSongChat(songId: string): Promise<{ messages?: ChatTurn[]; error?: string }> {
  const { env, userId } = await who();
  return songs.loadSongChat(env, userId, songId);
}

export async function saveSongChat(songId: string, messages: ChatTurn[]): Promise<{ ok?: boolean; error?: string }> {
  const { env, userId } = await who();
  return songs.saveSongChat(env, userId, songId, messages);
}

/** Heart a published song, or take the heart back. Returns the fresh count. */
export async function setLike(
  songId: string,
  liked: boolean,
): Promise<{ liked?: boolean; likes?: number; error?: string }> {
  const { env, userId } = await who();
  return songs.setLike(env, userId, songId, liked);
}

/** Which of these songs the signed-in visitor has hearted (LikeButton). */
export async function likedSongIds(ids: string[]): Promise<string[]> {
  const { env, userId } = await who();
  return songs.likedSongs(env, userId, Array.isArray(ids) ? ids.slice(0, 200) : []);
}
