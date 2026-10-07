import type { Metadata } from "next";
import Toy from "./home/Toy";
import Who from "./home/Who";
import PlayableAvatar from "./PlayableAvatar";
import PatchCard from "./home/PatchCard";
import SongCard from "./home/SongCard";
import { HOME_PATCHES, loadFeed } from "./home/feed";
import styles from "./home/home.module.css";
import { SHARE_IMAGE, SITE_URL, shareCard } from "./shareCard";

// The homepage. The studio itself is at /studio (app/studio/page.tsx); links
// that still name the studio's old place at / (`?s=`, `?open=`, `?jam=`) are
// redirected there by next.config.mjs before this page is reached.
//
// Rendered once a minute and cached in between: see feed.ts for why the feed
// reads no cookies, and Who.tsx for how a signed-in visitor still gets their
// own name in the corner.
export const revalidate = 60;

const TITLE = "seqbaby · a step sequencer with opinions";
const DESCRIPTION =
  "Turn the knobs. All of them. At once. A step sequencer in a browser tab: analog and FM models, 808s, samples, and songs people just made.";

// The homepage's own card: the hero line over the latest published songs
// (app/api/og/home). Pinned to the site's origin, not the request's, because
// reading the host would make this cached page dynamic.
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  ...shareCard(TITLE, DESCRIPTION, `${SITE_URL}api/og/home`),
};

// The emulators. Drawn alphabetically with INSTRUMENTS, below.
const EMULATORS = [
  ["silverbox", "an acid box, modelled from its circuit. three filter poles, accents that pile up when the resonance is high, and a slide when you tie one step into the next."],
  ["contagion", "a digital polysynth. two filters with a saturator between them, oscillators that morph from sine to pulse, and unison up to eight voices wide."],
  ["hexop", "six sine operators and thirty-two algorithms, with an envelope on every operator. the sound is the routing and the levels, so there is a lot to program."],
  ["snarl", "a monosynth with a saw, an ultrasaw, a pulse with pwm, a triangle you can fold into metal, and a sub. it gets rough when you push it."],
  ["ladder", "three oscillators into a warm filter. the fat mono lead and bass sound, with the second and third oscillators detuned or dropped an octave."],
  ["drift", "a dco with a square sub and noise, a high-pass, and the chorus built in. it does pads and it does them well."],
  ["electric guitar", "the whole rig in one model: strings, pickup, tone pot, amp, cab. turn bloom up and the speaker feeds back into the strings until the note howls."],
  ["electric bass", "the same strings, wound and stiffer, with a dirt path that leaves the lows alone, a compressor that is always on, and an octaver."],
  ["subby", "a sub bass for the bottom two octaves. it adds the harmonics a small speaker needs, so a 40hz note comes through on a phone."],
  ["drone", "an oscillator that is a formula and a counter, into an ms-20 style filter, a delay that can run backwards, and a cloud of grains. notes hold until the next one arrives."],
  ["vox", "a singing voice: a glottal pulse through five formants, with consonants and a choir of copies. type a lyric in the panel and it sings the words."],
  ["lancet", "a snare drum, seven different ways, under four knobs. a randomizer can throw the knobs on every hit."],
  ["siege", "a bass drum. a sine under a pitch envelope, with a wavefolder after the amp envelope, so the attack gets crushed and the tail stays clean."],
  ["tines", "an electric piano. a hammer, a tine and a tone bar, with chorus on the way out."],
  ["oracle", "a polyphonic analog synth. two oscillators, a sub, noise, and an overdrive stage on the output."],
] as const;

// The other instruments, in the same list.
const INSTRUMENTS = [
  ["plaits", "a port of the mutable instruments plaits oscillator, all sixteen models, running in wasm."],
  ["drum kits", "808 and 909 voices built as synth recipes, and three acoustic kits recorded one hit at a time."],
  ["sampler", "plays your own files, or a bundled kit sample. regions, fades, loops and slices per step."],
  ["granular", "a sample as a cloud of grains. size, density, position and spray on the four sliders, with speed and pitch kept separate."],
  ["wavetable", "a multi-frame wavetable synth over the akwf tables, morphable between frames, with an editor for drawing your own."],
] as const;

// The fx rack, drawn alphabetically. The gain stage is left out: a gain is
// not something to advertise.
const FX = [
  ["vinyl", "wow, crackle and a warmth filter. the crackle only runs while the track is playing."],
  ["cassette", "flutter, hiss and tape saturation."],
  ["fuzz", "a fuzz with drive, tone and level."],
  ["ring mod", "ring modulation against a sine, from 20hz up to 3khz."],
  ["shaper", "a waveshaper with a preamp in front of it and a choice of curves."],
  ["crush", "a bitcrusher modelled as a converter: a sample clock set in hertz and a quantiser that clips at full scale, so it aliases the way the old ones did."],
  ["auto-wah", "a wah that follows the envelope of what you play."],
  ["chorus", "chorus, with rate and depth."],
  ["phaser", "phaser, with rate and depth."],
  ["flanger", "flanger, with rate and feedback."],
  ["pitch shift", "a pitch shifter, in semitones."],
  ["beat repeat", "a beat repeat and a slicer, clocked by the sequencer, so repeats and swapped slices land on the grid."],
  ["prism", "four modules in one stage: a character, a movement, a diffusion and a texture, each with five modes."],
  ["pan", "a panner. put an lfo on it and it sweeps."],
  ["delay", "a delay with feedback, free or synced to the tempo."],
  ["reverb", "a reverb built as a delay network rather than an impulse, so the decay knob turns while it plays."],
] as const;

/** Alphabetical, by the first field. */
const byName = <T extends readonly [string, string]>(rows: T[]) => rows.sort((a, b) => a[0].localeCompare(b[0]));

const FEATURES = [
  ["jam", "send someone a link and you are both editing the same song at the same time. they do not need an account."],
  ["compose", "ask for a bassline in plain words. it plays over what is already running, and you decide whether to keep it."],
  ["euclid + chance", "the ring spreads hits evenly across the steps. the die writes a whole part, rhythm and pitch, from probabilities you set."],
  ["strudel", "your song opens as live code. edit the mini-notation, press ctrl+enter, and it lands in the song while it keeps playing."],
  ["vim mode", "hjkl around the grid, i to play notes in, a command line for the knobs. you can leave the mouse alone for a while."],
  ["fx bus", "a track with no instrument that other tracks run through, so several can share one filter, one rack and one set of lanes."],
] as const;

const BLURBS = [
  "no install. no plugin. no manual (there is a manual).",
  "32 patterns per song, which is at least 29 more than you'll finish.",
  "undo goes back 100 steps. regret goes back further.",
];

// Structured data for search engines. The WebSite block is what Google reads
// for the site name in a result (without it the result says
// "playseqbaby.com"); the Organization's logo and the app's image are what it
// can put beside one.
const JSON_LD = JSON.stringify([
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "seqbaby",
    alternateName: ["playseqbaby", "seqbaby step sequencer"],
    url: SITE_URL,
  },
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "seqbaby",
    url: SITE_URL,
    logo: `${SITE_URL}icons/icon-512.png`,
  },
  {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "seqbaby",
    url: `${SITE_URL}studio`,
    description: DESCRIPTION,
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Any (web browser)",
    browserRequirements: "Requires a browser with Web Audio",
    image: SHARE_IMAGE,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  },
]).replace(/</g, "\\u003c");

export default async function HomePage() {
  const { songs, people, patches } = await loadFeed();

  return (
    <div className={styles.home}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
      <nav className={styles.nav}>
        <a className={styles.brand} href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.svg" alt="" width={22} height={22} />
          seqbaby
        </a>
        <span className={styles.navLinks}>
          <a className={styles.navLink} href="/songs">songs</a>
          <a className={styles.navLink} href="/people">people</a>
          <a className={styles.navLink} href="/patches">patches</a>
          <a className={styles.navLink} href="/manual">manual</a>
          <Who />
          <a className={`${styles.navLink} ${styles.navCta}`} href="/studio">open the studio →</a>
        </span>
      </nav>

      <header className={styles.hero}>
        <div className={styles.heroText}>
          <p className={styles.kicker}>a step sequencer in a browser tab</p>
          <h1 className={styles.title}>
            turn the knobs. all of them. <span className={styles.wobble}>at once.</span>
          </h1>
          <p className={styles.lede}>
            seqbaby is a step sequencer that runs in a browser tab. it has fifteen modelled
            instruments, 808 and 909 kits, a sampler, a mod matrix and an fx rack. share a song with a
            link, or jam on one with a friend.
          </p>
          <div className={styles.ctaRow}>
            <a className={styles.cta} href="/studio">open the studio</a>
            <a className={styles.ctaGhost} href="/login?mode=signup">make an account</a>
          </div>
          <p className={styles.small}>you don&apos;t need an account to play. you need one to save.</p>
        </div>
        <div className={styles.heroToy}>
          <Toy />
          <p className={styles.toyNote}>
            ↑ this one&apos;s a toy. the real one is in the studio, with 32 patterns and a mod matrix.
          </p>
        </div>
      </header>

      <ul className={styles.ticker} aria-hidden>
        {[...BLURBS, ...BLURBS].map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>
            <a className={styles.sectionTitleLink} href="/songs">on repeat</a>
          </h2>
          <a className={styles.sectionLink} href="/songs">explore every song →</a>
        </div>
        {songs.length ? (
          <ul className={styles.cards}>
            {songs.map((s) => (
              <SongCard key={s.id} song={s} />
            ))}
          </ul>
        ) : (
          <div className={styles.empty}>
            <p className={styles.emptyBig}>¯\_(ツ)_/¯</p>
            <p>
              nothing published yet. <a href="/studio">open the studio</a>, make something, and publish
              it from the songs menu. it shows up here.
            </p>
          </div>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>
            <a className={styles.sectionTitleLink} href="/people">people making noise</a>
          </h2>
          <a className={styles.sectionLink} href="/people">find everyone →</a>
        </div>
        {people.length ? (
          <ul className={styles.people}>
            {people.map((p) => (
              <li key={p.handle}>
                <a className={styles.person} href={`/u/${p.handle}`}>
                  <PlayableAvatar grid={p.avatarGrid} name={p.handle} size={44} />
                  <span className={styles.personText}>
                    <span className={styles.personName}>@{p.handle}</span>
                    {p.bio && <span className={styles.personBio}>{p.bio}</span>}
                    <span className={styles.personCount}>
                      {p.songs} {p.songs === 1 ? "song" : "songs"}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.emptyLine}>
            nobody here yet. <a href="/login?mode=signup">make an account</a> and you&apos;ll be the first.
          </p>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>
            <a className={styles.sectionTitleLink} href="/patches">fresh patches</a>
          </h2>
          <a className={styles.sectionLink} href="/patches">see every patch →</a>
        </div>
        {patches.length ? (
          <ul className={styles.cards}>
            {patches.slice(0, HOME_PATCHES).map((p) => (
              <PatchCard key={p.id} patch={p} />
            ))}
          </ul>
        ) : (
          <p className={styles.emptyLine}>
            no patches yet. <a href="/studio">make a sound</a>, save it as a patch, and publish it from the patches
            menu.
          </p>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>the instruments</h2>
          <span className={styles.sectionSub}>fifteen emulators, each one a working model of the thing that makes the sound: a circuit, a string, a drum head, a voice. then the rest of the catalog.</span>
        </div>
        <ul className={styles.stack}>
          {byName([...EMULATORS, ...INSTRUMENTS]).map(([name, line]) => (
            <li key={name} className={styles.stackItem}>
              <strong>{name}</strong>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>the fx rack</h2>
          <span className={styles.sectionSub}>seventeen stages on every track, in whatever order you put them. any of them can be on a track more than once.</span>
        </div>
        <ul className={styles.box}>
          {byName([...FX]).map(([name, line], i) => (
            <li key={name} className={styles.boxItem} style={{ ["--tilt" as string]: `${(i % 3) - 1}deg` }}>
              <strong>{name}</strong>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>what else is in the box</h2>
          <span className={styles.sectionSub}>the rest of the studio, in short. the manual has the long version.</span>
        </div>
        <ul className={styles.box}>
          {FEATURES.map(([name, line], i) => (
            <li key={name} className={styles.boxItem} style={{ ["--tilt" as string]: `${(i % 3) - 1}deg` }}>
              <strong>{name}</strong>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      <footer className={styles.footer}>
        <a href="/studio">studio</a>
        <a href="/songs">songs</a>
        <a href="/people">people</a>
        <a href="/patches">patches</a>
        <a href="/manual">manual</a>
        <a href="/superbugs" title="found a bug? tell us">superbugs</a>
        <span className={styles.footNote}>made with too many oscillators.</span>
      </footer>
    </div>
  );
}
