/** A song's fingerprint: four lanes of sixteen steps, hashed from its id. It
 *  is not the song's rhythm (that would mean reading the whole session) --
 *  just a face that stays the same every time the card is drawn. */
export function fingerprint(id: string): boolean[][] {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const next = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  // Denser at the bottom (hats), sparser at the top (the kick), the way a beat
  // usually looks written down.
  const density = [0.28, 0.2, 0.55, 0.35];
  return density.map((d, lane) =>
    Array.from({ length: 16 }, (_, i) => (lane === 0 && i % 4 === 0 ? next() < 0.8 : next() < d)),
  );
}
