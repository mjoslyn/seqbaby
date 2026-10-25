"use server";

import { cfEnv } from "@/lib/cf";
import { currentUserId } from "@/lib/auth/session";
import * as patches from "@/lib/data/patches.js";

export type MyPatch = {
  id: string;
  name: string;
  engine_type: string | null;
  is_public: boolean;
  created_at: string;
};

async function who() {
  const [env, userId] = await Promise.all([cfEnv(), currentUserId()]);
  return { env, userId };
}

// Save someone's published patch into your own bay: a private copy of it,
// remembering where it came from (`saved_from`), so a second save finds the
// first copy instead of making another. Your own patch is in your bay already.
export async function savePatchToBay(
  sourceId: string,
): Promise<{ id?: string; name?: string; already?: boolean; error?: string }> {
  const { env, userId } = await who();
  return patches.savePatchToBay(env, userId, sourceId);
}

// Publish or unpublish a patch in your bay. Unpublishing keeps it: it leaves
// the gallery, not your patches.
export async function setPatchPublic(id: string, isPublic: boolean): Promise<{ ok?: boolean; error?: string }> {
  const { env, userId } = await who();
  return patches.setPatchPublic(env, userId, id, isPublic);
}

export async function listMyPatches(): Promise<{ patches: MyPatch[]; error?: string }> {
  const { env, userId } = await who();
  return patches.listMyPatches(env, userId);
}

export async function deletePatch(id: string): Promise<{ ok?: boolean; error?: string }> {
  const { env, userId } = await who();
  return patches.deletePatch(env, userId, id);
}

/** Heart or un-heart a public patch, the patch twin of setLike. */
export async function setPatchLike(
  patchId: string,
  liked: boolean,
): Promise<{ liked?: boolean; likes?: number; error?: string }> {
  const { env, userId } = await who();
  return patches.setPatchLike(env, userId, patchId, liked);
}

/** Which of these patches the signed-in visitor has hearted (LikeButton). */
export async function likedPatchIds(ids: string[]): Promise<string[]> {
  const { env, userId } = await who();
  return patches.likedPatches(env, userId, Array.isArray(ids) ? ids.slice(0, 200) : []);
}

/** Which of these patches are in the visitor's bay already: their own, or one
 *  they saved a copy of (SavePatchButton). */
export async function patchesInMyBay(ids: string[]): Promise<string[]> {
  const { env, userId } = await who();
  return patches.savedFrom(env, userId, Array.isArray(ids) ? ids.slice(0, 200) : []);
}
