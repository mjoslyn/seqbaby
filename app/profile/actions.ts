"use server";

import { revalidatePath } from "next/cache";
import { cfEnv } from "@/lib/cf";
import { currentUserId } from "@/lib/auth/session";
import * as profiles from "@/lib/data/profiles.js";

export type Profile = {
  id: string;
  username: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  /** The step-grid avatar (app/profile/avatarGrid.js), or null for the one
   *  the name generates. */
  avatar_grid: string | null;
  is_public: boolean;
  created_at: string;
};

export type ProfileSong = {
  id: string;
  title: string;
  share_slug: string | null;
  updated_at: string;
  forked_from: string | null;
  remixedFrom: { title: string; username: string | null } | null;
  /** The step preview (app/songs/songPreview.js). */
  preview?: unknown;
  /** Hearts. */
  likes?: number;
  /** Started from its owner's template, so `forked_from` is no remix. */
  from_template?: boolean;
};
export type ProfilePatch = {
  id: string;
  name: string;
  engine_type: string | null;
  created_at: string;
  /** The engine it plays on and the fields its picture needs, read out of
   *  `config` without the rest of it (a sampler patch carries base64). */
  kind: string | null;
  engine: string | null;
  drum: unknown;
  sample: string | null;
  /** Hearts. */
  likes?: number;
};

export type PublicProfile =
  | { notFound: true }
  | { private: true; username: string }
  | {
      profile: Profile;
      isOwner: boolean;
      songs: ProfileSong[];
      patches: ProfilePatch[];
    };

async function who() {
  const [env, userId] = await Promise.all([cfEnv(), currentUserId()]);
  return { env, userId };
}

export async function getMyProfile(): Promise<Profile | null> {
  const { env, userId } = await who();
  return profiles.getMyProfile(env, userId);
}

// One name per person: the username is the name, and display_name is written
// with it so an older reader of that column shows the same thing.
export async function updateProfile(input: {
  username?: string;
  bio?: string;
  avatar_url?: string;
  /** A grid string, or null to go back to the name's generated one. */
  avatar_grid?: string | null;
  is_public?: boolean;
}): Promise<{ ok?: boolean; error?: string }> {
  const { env, userId } = await who();
  const res = await profiles.updateProfile(env, userId, input);
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

export async function getPublicProfile(username: string): Promise<PublicProfile> {
  const { env, userId } = await who();
  return (await profiles.getPublicProfile(env, userId, username)) as PublicProfile;
}
