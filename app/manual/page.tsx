import type { Metadata } from "next";
import styles from "./manual.module.css";

export const metadata: Metadata = {
  title: "seqbaby manual",
  description: "How to use seqbaby: transport, patterns, tracks, engines, the piano roll, effects, saving and sharing.",
};

const SECTIONS = [
  ["start", "Getting started"],
  ["transport", "Transport"],
  ["knobs", "Knobs"],
  ["patterns", "Patterns"],
  ["tracks", "Tracks"],
  ["steps", "The step grid"],
  ["roll", "The piano roll"],
  ["step-editor", "The step editor"],
  ["generators", "The three generators"],
  ["keyboard", "Playing from your keyboard"],
  ["scale", "Scale and chords"],
  ["engines", "Sound engines"],
  ["silverbox", "The silverbox"],
  ["contagion", "The contagion"],
  ["hexop", "The hexop"],
  ["guitar", "The guitar and the bass"],
  ["subby", "Subby"],
  ["sampler", "Samples"],
  ["wavetable", "The wavetable editor"],
  ["shaping", "Filter, effects and dynamics"],
  ["bus", "Fx buses"],
  ["lock", "p-lock"],
  ["motion", "Modulation and automation"],
  ["macro", "Macro pads"],
  ["undo", "Undo"],
  ["saving", "Saving, sharing and export"],
  ["trouble", "If something sounds wrong"],
  ["credits", "Credits and licences"],
];

export default function ManualPage() {
  return (
    <div className={styles.page}>
      <div className={styles.wrap}>
        <div className={styles.top}>
          <a className={styles.brand} href="/">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/favicon.svg" alt="" />
            seqbaby
          </a>
          <a className={styles.backBtn} href="/">back to the studio</a>
        </div>

        <h1>Manual</h1>
        <p className={styles.lede}>
          seqbaby is a step sequencer that runs in a browser tab. Each track plays
          its own instrument, you fill a grid of steps, and you pile effects and
          movement on top. Nothing to install, and nothing leaves your machine
          unless you save or share it.
        </p>

        <nav className={styles.toc}>
          <h2>Contents</h2>
          <ol>
            {SECTIONS.map(([id, title]) => (
              <li key={id}><a href={`#${id}`}>{title}</a></li>
            ))}
          </ol>
        </nav>

        <section className={styles.section} id="start">
          <h2>Getting started</h2>
          <p>
            Press <span className={styles.ui}>play</span>. Browsers keep audio muted
            until you have interacted with the page, so the first press is really
            just permission. If you hear nothing, press it again.
          </p>
          <p>
            A new session opens with a few drum tracks already running. Click any
            cell in a track&apos;s row of squares to add or remove a hit. After that:
          </p>
          <ul>
            <li>The dropdown next to a track&apos;s name changes what it sounds like.</li>
            <li><span className={styles.ui}>+ add track</span> at the bottom gets you another instrument.</li>
            <li>The numbered buttons above the tracks are 32 pattern slots.</li>
            <li>Right-click anything you don&apos;t recognise. You get what it does and whatever movement is on it.</li>
          </ul>
          <div className={styles.note}>
            The studio works on a phone, but it is built for a desktop or laptop.
            A big screen and a computer keyboard make it much easier to play.
          </div>
        </section>

        <section className={styles.section} id="transport">
          <h2>Transport</h2>
          <p>The bar across the top runs playback for everything.</p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Control</th><th>What it does</th></tr>
              </thead>
              <tbody>
                <tr><td>play</td><td>Starts and stops the sequencer. Playback always restarts from the top.</td></tr>
                <tr><td>record</td><td>With the sequencer running, anything you play on your computer keyboard is written into the active track.</td></tr>
                <tr><td>capture</td><td>Writes the phrase you just played into the active track even though you weren&apos;t recording. It keeps the last 32 seconds, takes the run of notes since your last pause, and keeps the lengths you held.</td></tr>
                <tr><td>bpm</td><td>Tempo. Type a number, or drag the field up and down.</td></tr>
                <tr><td>swing</td><td>Pushes every second step later, from dead straight to a heavy shuffle.</td></tr>
                <tr><td>macro</td><td>Opens the XY <a href="#macro">macro pads</a>.</td></tr>
                <tr><td>undo / redo</td><td>Steps back and forward through your edits. See <a href="#undo">undo</a>.</td></tr>
                <tr><td>metronome</td><td>A click on each downbeat, for playing along. It never ends up in an export.</td></tr>
                <tr><td>meter</td><td>Output level, over on the right. If it sits pinned at the top, turn some tracks down.</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            The second row is the keyboard strip: scale, octave, chord and arp,
            covered under <a href="#keyboard">playing from your keyboard</a>. The
            status line at its right end reports what just happened.
          </p>
          <p>
            Above the transport sit <span className={styles.ui}>new</span>,{" "}
            <span className={styles.ui}>share</span>, and, once you are signed in,{" "}
            <span className={styles.ui}>save</span> and{" "}
            <span className={styles.ui}>songs</span>. See{" "}
            <a href="#saving">saving and sharing</a>.
          </p>
        </section>

        <section className={styles.section} id="knobs">
          <h2>Knobs</h2>
          <p>
            Nearly every parameter is a knob, and they all behave the same way.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Gesture</th><th>Result</th></tr>
              </thead>
              <tbody>
                <tr><td>Drag</td><td>Grab anywhere on the knob. The value doesn&apos;t jump to your click, it follows the pointer from wherever it already was.</td></tr>
                <tr><td>Drag out sideways</td><td>Fine trim. The further from the knob your pointer travels, the smaller each pixel gets, so one gesture does the sweep and the trim. Shift forces fine mode.</td></tr>
                <tr><td>Wheel</td><td>Nudges the value a step at a time.</td></tr>
                <tr><td>Double-click</td><td>Back to the default.</td></tr>
                <tr><td>Right-click, or long press</td><td>Opens the <a href="#motion">parameter menu</a>: what the control does, and any modulation on it.</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            On a phone the same controls draw as vertical sliders and the thumb
            follows your finger. Two rows stay sliders everywhere: the wavetable
            editor&apos;s harmonic bars and the chance generator&apos;s pitch faders.
          </p>
        </section>

        <section className={styles.section} id="patterns">
          <h2>Patterns</h2>
          <p>
            Every session has 32 pattern slots. Click a number to switch to it; the
            one you are editing is outlined. Empty slots are blank, so one slot per
            section is an easy way to build an arrangement.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Control</th><th>What it does</th></tr>
              </thead>
              <tbody>
                <tr><td>repeat / chain</td><td>Repeat loops the current pattern. Chain plays your non-empty patterns in order, like a song.</td></tr>
                <tr><td>immediate / finish</td><td>Whether clicking another pattern switches straight away or waits out the current bar.</td></tr>
                <tr><td>dup</td><td>Copies this pattern into the next free slot. The usual way to start a variation.</td></tr>
                <tr><td>drag a number</td><td>Drops a copy of that pattern onto any other slot and takes you there. In finish mode while playing it waits for the bar, like any other switch.</td></tr>
                <tr><td>sig</td><td>Time signature for this pattern, from 4/4 through 5/4, 7/8 and the compound meters.</td></tr>
                <tr><td>rep</td><td>In chain mode, how many bars this pattern gets before the next one.</td></tr>
                <tr><td>Pattern / Session</td><td>Render audio and download a WAV. See <a href="#saving">export</a>.</td></tr>
              </tbody>
            </table>
          </div>
          <div className={styles.note}>
            Patterns hold notes, not sounds. Switching leaves your instruments,
            effects and mixer settings where they were, because those belong to the
            track. If you want the opposite, a track&apos;s{" "}
            <span className={styles.ui}>p-lock</span> button gives it a sound of its
            own in <em>this</em> pattern. See <a href="#lock">p-lock</a>.
          </div>
        </section>

        <section className={styles.section} id="tracks">
          <h2>Tracks</h2>
          <p>
            A track is one instrument plus its pattern. The header row has its name,
            its engine, the pattern length and the mixer controls.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Control</th><th>What it does</th></tr>
              </thead>
              <tbody>
                <tr><td>len</td><td>How many steps this track loops over. Lengths don&apos;t have to match: a 12-step track against a 16-step one drifts in and out of phase.</td></tr>
                <tr><td>+1 x2 x4 /2 /4</td><td>Grow or shrink the pattern. Growing copies what is already there.</td></tr>
                <tr><td>spd</td><td>Runs this track faster or slower than the rest, from 1/16 up to 16 times.</td></tr>
                <tr><td>out</td><td>Where the track goes: straight to the master, or into an fx bus. It only appears once a bus exists. See <a href="#bus">fx buses</a>.</td></tr>
                <tr><td>vol</td><td>Track volume, with its level meter behind the knob.</td></tr>
                <tr><td>the four knobs</td><td>The instrument&apos;s main tone controls. What they do, and what they are called, changes with the engine. <span className={styles.ui}>rand</span> beside them rolls all four.</td></tr>
                <tr><td>wave / save / load icons</td><td>The sample or wavetable editor for this engine, save this sound as a patch, load a saved patch.</td></tr>
                <tr><td>solo / mute</td><td>Hear only this track, or silence it.</td></tr>
                <tr><td>p-lock</td><td>Gives this track a sound of its own on the pattern you are on. See <a href="#lock">p-lock</a>.</td></tr>
                <tr><td>clear</td><td>Empties this pattern on this track.</td></tr>
                <tr><td>dice</td><td>Rolls a new pattern. Keep pressing until one sticks; drag it up or down to set how full the rolls come out. See <a href="#generators">the three generators</a>.</td></tr>
                <tr><td>ring</td><td>Euclidean rhythms. See <a href="#generators">the three generators</a>.</td></tr>
                <tr><td>die</td><td>Chance: a whole part, rhythm and pitches, from probabilities. See <a href="#generators">the three generators</a>.</td></tr>
                <tr><td>dup / remove</td><td>Copy the whole track, sound and all, or delete it.</td></tr>
                <tr><td>oct / semi</td><td>Transposes everything in the pattern up or down.</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            The last row of buttons (<span className={styles.ui}>roll</span>,{" "}
            <span className={styles.ui}>filter</span>, <span className={styles.ui}>env</span>,{" "}
            <span className={styles.ui}>fx</span>, <span className={styles.ui}>eq</span>,{" "}
            <span className={styles.ui}>comp</span>, <span className={styles.ui}>mod</span>,{" "}
            <span className={styles.ui}>aut</span>) opens the panels described under{" "}
            <a href="#shaping">filter, effects and dynamics</a> and{" "}
            <a href="#motion">modulation and automation</a>.
          </p>
          <p>
            A button wears a dot with a count when something inside it is switched
            on, and hovering it names what. Whatever is on also shows on the track
            itself: engaged effects, enabled LFO rows, a filter you have closed, an
            eq band you have moved. Open the panel and you get all of it again.
          </p>
        </section>

        <section className={styles.section} id="steps">
          <h2>The step grid</h2>
          <p>
            The row of squares is the pattern. A filled square is a note, and every
            fourth one is marked so you can find the beat.
          </p>
          <ul>
            <li><strong>Click</strong> an empty square to add a note, or a filled one to take it away.</li>
            <li><strong>Drag right</strong> from a note to make it longer.</li>
            <li><strong>Drag up or down</strong> on a note to change its pitch.</li>
            <li><strong>Double-click</strong> to set a note to full velocity.</li>
            <li><strong>Right-click</strong>, or press and hold on a touchscreen, for the step editor.</li>
          </ul>
          <p>
            On drum tracks the pitch hardly matters, so the grid is usually all you
            need. Melodies are easier in the piano roll.
          </p>
        </section>

        <section className={styles.section} id="roll">
          <h2>The piano roll</h2>
          <p>
            <span className={styles.ui}>roll</span> opens a pitch-by-time grid: pitch
            up the side, steps across. It is the best place to write a melody, and
            the only place to stack notes into a chord you voice by hand.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Gesture</th><th>Result</th></tr>
              </thead>
              <tbody>
                <tr><td>Click empty space</td><td>Adds a one-step note. Keep dragging right to lengthen it as you go.</td></tr>
                <tr><td>Drag a note&apos;s middle</td><td>Moves the whole note in time and pitch. The length stays put.</td></tr>
                <tr><td>Drag a note&apos;s edge</td><td>Resizes it. Left edge moves the start, right edge the end.</td></tr>
                <tr><td>Drag a one-step note</td><td>The thin right-hand sliver resizes, the rest moves. The cursor tells you which one you are on.</td></tr>
                <tr><td>Double-click a note</td><td>Deletes it. On a stacked note it deletes only the row you clicked.</td></tr>
                <tr><td>Click an empty row above a note</td><td>Stacks another pitch onto that step, for chords you voice yourself.</td></tr>
                <tr><td>Right-click / long press</td><td>Opens the step editor for that note.</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            The lane underneath is velocity: drag a bar to make that step harder or
            softer. The buttons along the top shift every note up a step, double or
            halve the pattern length, or roll a new melody.
          </p>
          <div className={styles.note}>
            A track plays one note at a time per step, so a note stops where the next
            one starts. To hear pitches together, stack them on the same step or use
            a chord in the step editor.
          </div>
        </section>

        <section className={styles.section} id="step-editor">
          <h2>The step editor</h2>
          <p>
            Right-click any step for everything it can do beyond pitch and length.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Setting</th><th>What it does</th></tr>
              </thead>
              <tbody>
                <tr><td>note</td><td>The pitch, on a small keyboard.</td></tr>
                <tr><td>chord</td><td>Plays a whole chord from that root: major, minor, sevenths and the rest, plus an inversion.</td></tr>
                <tr><td>arp</td><td>The chord&apos;s notes play one after another across the length of the note instead of together. Set how fast, how many octaves, and which direction.</td></tr>
                <tr><td>ratchet</td><td>Retriggers the step up to 8 times. Drum rolls and stutters.</td></tr>
                <tr><td>vel</td><td>How hard the note hits.</td></tr>
                <tr><td>offset</td><td>Nudges the step slightly early or late for a looser feel.</td></tr>
              </tbody>
            </table>
          </div>
          <div className={styles.note}>
            An arp fills the note&apos;s length, so give it room. A one-step note at a
            1/16 arp rate has space for exactly one note, which sounds like nothing
            happening. Lengthen the note or pick a faster rate.
          </div>
        </section>

        <section className={styles.section} id="generators">
          <h2>The three generators</h2>
          <p>
            Three buttons on the track row fill the grid for you: the dice rolls a
            part, the ring divides the bar evenly, the die throws odds. All three can
            print a result into the grid as ordinary steps you can then edit. The ring
            and the die also run <strong>live</strong>, generating as the track plays
            without writing anything, so their controls can take an LFO, an automation
            lane or a macro pad; switch live off and the pattern is exactly as you left
            it. While live is on the grid shows what is playing and goes read-only. A
            track has one rhythm at a time, so turning one of those two on turns the
            other off.
          </p>

          <h3>The dice: roll a part</h3>
          <p>
            One press replaces the pattern with a new one, rhythm and pitches both.
            Keep pressing until something sticks; nothing is held, so each roll starts
            from scratch. What lands in the grid is ordinary steps, yours to edit
            afterwards.
          </p>
          <p>
            Drag the dice up or down to set how full the rolls come out, drawn as the
            fill behind the icon. All the way down is empty, all the way up is every
            step, and downbeats stay likelier than the steps between them.
          </p>
          <p>
            On a drum-kit track every hit sits on C2 and only the rhythm changes.
            Anywhere else it walks a melody in the session&apos;s key, mostly a step or
            two at a time with the occasional octave leap, starting from the last note
            you used on that track. It follows the root and mode even when scale
            quantize is off. It leaves the sound alone;{" "}
            <span className={styles.ui}>rand</span> beside the four knobs is the one
            that rolls that.
          </p>

          <h3>The ring: euclidean rhythms</h3>
          <p>
            A number of hits spread as evenly as possible over a cycle, which covers
            a lot of the world&apos;s drumming. Set the hits, the cycle length and a
            rotation, and the cycle tiles across the track. It decides only{" "}
            <em>when</em> notes happen; the pitches stay whatever the pattern already
            had.
          </p>

          <h3>The die: chance</h3>
          <p>
            Chance decides the pitches as well. You write the odds of notes rather
            than the notes, and it plays something that fits them. Two sections, each
            with its own dice.
          </p>
          <p>
            <strong>Rhythm.</strong> <span className={styles.ui}>note value</span> is
            the base rhythm, from 1/1 down to 1/32 by way of the triplets, and nothing
            random happens to it on its own.{" "}
            <span className={styles.ui}>variation</span> is off in the middle: turn it
            left for longer note values, right for shorter, and how far you turn it is
            both how often another value turns up and how far from the base it strays.{" "}
            <span className={styles.ui}>legato</span> is how likely a note is to be
            tied to the one before instead of gating again; all the way up you get a
            single held note. <span className={styles.ui}>rest</span> is how likely a
            note is to be dropped. Two checkboxes let variation reach the triplets and
            the 1/32s, which are off to start with.
          </p>
          <p>
            <strong>Melody.</strong> The twelve faders are the probability of each
            semitone, not a switch on each: one at half height turns up half as often
            as one at full, and a single raised fader is certain wherever it sits.
            That is how you write a scale here, or a scale with a bias.{" "}
            <span className={styles.ui}>from scale</span> loads the session&apos;s
            active scale into them. Generated notes are not snapped to the session
            scale, because these faders <em>are</em> the scale.{" "}
            <span className={styles.ui}>low note</span> and{" "}
            <span className={styles.ui}>high note</span> set the range, up to five
            octaves; a semitone raised outside it can&apos;t play, and its label greys
            out to say so.
          </p>
          <p>
            <strong>The dice.</strong> Each section&apos;s{" "}
            <span className={styles.ui}>roll</span> takes a new throw. A throw is
            held, so the part repeats and you can play against it. Tick{" "}
            <span className={styles.ui}>realtime</span> on a section and it stops
            holding: a new throw every time round, so that section never repeats.
            Rolling a section twice always changes something; if a throw can&apos;t
            change anything, the button says which knob to turn instead.
          </p>
          <p>
            <strong>The window</strong> is the first and last step it generates over,
            and it tiles across the track like the ring&apos;s cycle. Moving{" "}
            <span className={styles.ui}>first step</span> slides the window without
            changing its length.
          </p>
          <p>
            Six controls can be modulated while live is on: the four rhythm knobs and
            the two range knobs. An LFO on <span className={styles.ui}>rest</span>{" "}
            breathes the part in and out; a lane on{" "}
            <span className={styles.ui}>low note</span> walks it up the register over
            a bar. The picture at the top of the panel is the part it is playing now:
            height is pitch, width is how long a note is held, and a note in the
            second colour is struck more than once, which is how the triplets and the
            1/32s fit a grid of sixteenths.
          </p>
          <div className={styles.note}>
            Chance is modelled on Vermona&apos;s meloDICER, a eurorack module that
            generates a part from probabilities rather than storing one. The panel
            keeps its layout &mdash; a rhythm section of note value, variation, legato
            and rest, twelve semitone probability faders for the melody, and a range
            either side of them. Two things here are not on the module: each knob gets
            its own stream of dice, so turning{" "}
            <span className={styles.ui}>rest</span> up only drops notes instead of
            reshuffling the whole part, and a throw is a held seed, so a saved song
            replays the part it was written with.
          </div>
        </section>

        <section className={styles.section} id="keyboard">
          <h2>Playing from your keyboard</h2>
          <p>
            On a desktop machine your computer keyboard always plays the active
            track, which is the last one you clicked and the one with the outline.
            Typing in a text box is safe: note keys only fire when no text field has
            focus.
          </p>
          <p>
            The layout is a piano. The home row is the white keys, the row above it
            the black keys.
          </p>
          <ul>
            <li>
              White keys: <span className={styles.key}>a</span> <span className={styles.key}>s</span>{" "}
              <span className={styles.key}>d</span> <span className={styles.key}>f</span>{" "}
              <span className={styles.key}>g</span> <span className={styles.key}>h</span>{" "}
              <span className={styles.key}>j</span> <span className={styles.key}>k</span>{" "}
              <span className={styles.key}>l</span>
            </li>
            <li>
              Black keys: <span className={styles.key}>w</span> <span className={styles.key}>e</span>{" "}
              <span className={styles.key}>t</span> <span className={styles.key}>y</span>{" "}
              <span className={styles.key}>u</span> <span className={styles.key}>o</span>
            </li>
            <li>
              <span className={styles.key}>z</span> and <span className={styles.key}>x</span> drop and raise the octave.
            </li>
          </ul>
          <p>Two ways to get what you play into a pattern.</p>
          <ul>
            <li>
              <strong>Record.</strong> Switch on <span className={styles.ui}>record</span>,
              start playback, and notes land on whichever step is passing underneath.
            </li>
            <li>
              <strong>Capture.</strong> Play freely, stopped or running, then press{" "}
              <span className={styles.ui}>capture</span>. Your last phrase is written
              into the track with its timing and note lengths, and the pattern is
              sized to fit it.
            </li>
          </ul>
        </section>

        <section className={styles.section} id="scale">
          <h2>Scale and chords</h2>
          <p>
            Tick <span className={styles.ui}>scale</span>, pick a root and a mode, and
            your playing is locked to that key. The white keys all belong to the scale
            and the black keys go quiet, so there are no wrong notes. There are major
            and minor modes, pentatonics, blues, some exotic scales and a few
            microtonal tunings.
          </p>
          <p>
            The palette button next to it colours notes by pitch across the roll and
            the grid, which makes repeated shapes jump out.
          </p>
          <h3>Chord mode</h3>
          <p>
            With <span className={styles.ui}>chord</span> on, each key plays a whole
            chord instead of a single note. Pick the chord type and a voicing. If a
            scale is active the choice collapses to on or off, because the chord gets
            built from the scale itself: each degree gets the quality it should have
            and everything stays in key.
          </p>
          <p>
            Chords you record or capture are stored as chords rather than loose notes,
            so the roll shows one labelled note you can retune or move in a single go.
          </p>
          <h3>Arp</h3>
          <p>
            The <span className={styles.ui}>arp</span> box sits next to the chord
            picker. Switch it on and a held key arpeggiates as you play, at the rate,
            octave range and direction you choose. Anything you then record or capture
            carries those arp settings into the pattern.
          </p>
        </section>

        <section className={styles.section} id="engines">
          <h2>Sound engines</h2>
          <p>
            The dropdown beside a track&apos;s name picks its instrument. They come in
            groups:
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Group</th><th>What is in it</th></tr>
              </thead>
              <tbody>
                <tr><td>plaits</td><td>Sixteen synthesis models from the Mutable Instruments Plaits oscillator: virtual analogue, FM, wavetable, granular, noise and physical models.</td></tr>
                <tr><td>drum / synth</td><td>An 808 and 909 kit, a poly saw, an FM bell and a pad.</td></tr>
                <tr><td>Emulators</td><td>The <a href="#silverbox">silverbox</a>, the <a href="#contagion">contagion</a>, the <a href="#hexop">hexop</a>, an <a href="#guitar">electric guitar and bass</a>, and <a href="#subby">subby</a>, all modelled rather than sampled. Then five monosynth voices in the spirit of classic hardware: snarl, ladder, drift, tines and oracle.</td></tr>
                <tr><td>texture</td><td>A granular engine that plays a sample as a cloud of tiny grains. Load your own, or pick from the bundled library of pads and drones.</td></tr>
                <tr><td>wavetable</td><td>A wavetable synth with its own <a href="#wavetable">editor</a>.</td></tr>
                <tr><td>sampler</td><td>Your own audio, or one of the bundled kits. See <a href="#sampler">samples</a>.</td></tr>
                <tr><td>saved patches</td><td>Sounds you have saved yourself.</td></tr>
                <tr><td>midi</td><td>Sends notes to external hardware or software instead of making a sound itself.</td></tr>
                <tr><td>fx bus</td><td>Not an instrument. See <a href="#bus">fx buses</a>.</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            The four knobs under the name are that instrument&apos;s main tone
            controls: <span className={styles.ui}>harm</span>,{" "}
            <span className={styles.ui}>timb</span>,{" "}
            <span className={styles.ui}>morph</span> and{" "}
            <span className={styles.ui}>decay</span> on a Plaits model, something else
            on the next engine. The labels change with the engine, and hovering one
            says what it does on the instrument you have loaded.
          </p>
        </section>

        <section className={styles.section} id="silverbox">
          <h2>The silverbox</h2>
          <p>
            An acid box modelled from its circuits, so it answers a pattern the way
            the original does. Its four knobs are the panel:{" "}
            <span className={styles.ui}>cutoff</span>,{" "}
            <span className={styles.ui}>reso</span>,{" "}
            <span className={styles.ui}>env mod</span> and{" "}
            <span className={styles.ui}>decay</span>. Next to them are the waveform
            switch, the accent depth and tuning.
          </p>
          <p>Three behaviours are how you play it:</p>
          <ul>
            <li>
              <strong>Accent comes from step velocity.</strong> Push a step past about
              two-thirds and it accents: louder, brighter, filter decay forced short.
              With the resonance up, consecutive accents stack into a rising squelch
              rather than resetting, and that pile-up is the sound of an acid line.
            </li>
            <li>
              <strong>Slide comes from note length.</strong> Draw a step longer than
              one cell and the note after it slides out of it: the pitch glides across
              and the envelopes never retrigger.
            </li>
            <li>
              <strong>Plain steps get clipped short</strong>, a little over half the
              step, which is what makes a silverbox part drive instead of running
              together. Lengthen a note if you want it to hold.
            </li>
          </ul>
          <p>
            The filter thins out as you wind the resonance up, same as the real one.
            That is why acid records run a silverbox into a distortion pedal, and you
            can do the same from the track&apos;s <span className={styles.ui}>fx</span>{" "}
            panel.
          </p>
        </section>

        <section className={styles.section} id="contagion">
          <h2>The contagion</h2>
          <p>
            A big polyphonic synth built for movement. Its four knobs are{" "}
            <span className={styles.ui}>cutoff</span>,{" "}
            <span className={styles.ui}>reso</span>,{" "}
            <span className={styles.ui}>shape</span> and{" "}
            <span className={styles.ui}>decay</span>. The four beside them are the
            levels of osc 1, osc 2, the sub and the noise. Everything else lives in
            the three rows underneath.
          </p>
          <ul>
            <li>
              <strong>Shape</strong> is one continuous morph from sine through
              triangle and saw to pulse, and at the top the pulse width knob takes
              over. Sweep it and the tone changes character, not just brightness.
            </li>
            <li>
              <strong>Unison</strong> is the hypersaw. Each note plays up to eight
              detuned copies of the whole oscillator section, spread across the stereo
              field. Two or three thickens things up; eight with the detune wound on
              is the wide trance sound.
            </li>
            <li>
              <strong>Two filters, not one.</strong> Each can be a low pass, high
              pass, band pass or notch, and you choose how they connect: in series, in
              parallel, or split so filter 1 plays the left ear and filter 2 the right.
              A low pass into a high pass gives you a band pass you can sweep from both
              ends.
            </li>
            <li>
              <strong>Saturation sits between them</strong>, so filter 2 gets to tidy
              up whatever the saturator did. It runs from a gentle warmth through hard
              clipping to a bit reducer and a rate reducer.
            </li>
          </ul>
          <p>
            With sync on, osc 2 is forced to osc 1&apos;s pitch, so dragging or
            automating the{" "}
            <span className={styles.ui}>semi</span> knob gives you the classic tearing
            sync lead.
          </p>
        </section>

        <section className={styles.section} id="hexop">
          <h2>The hexop</h2>
          <p>
            Six sine waves. That is the whole instrument: no filter, no sub
            oscillator, nothing else. What comes out depends on which sines are wired
            into which, and how hard. The panel is the same six rows whatever you are
            building, one per operator, each with its level, its frequency as a ratio
            of the note, and its own envelope.
          </p>
          <ul>
            <li>
              <strong>The algorithm is the wiring.</strong> There are 32 of them and
              you can&apos;t make your own. The dropdown draws each one, so{" "}
              <span className={styles.ui}>1&larr;2</span> means operator 2 modulates
              operator 1. The panel marks the{" "}
              <em>carriers</em>, the operators that reach your ears, whose level is
              volume. Everything else is a modulator, and its level is how hard it
              bends the operator below it.
            </li>
            <li>
              <strong>Level is exponential.</strong> A modulator at half its knob is a
              sixteenth of full scale, so nearly all the useful range lives in the top
              quarter. Nudging one modulator level is how you program this thing.
            </li>
            <li>
              <strong>Every operator has its own envelope</strong>, so the timbre has
              an envelope. A modulator that decays fast under a carrier that
              doesn&apos;t is a struck sound. That is the trick behind an FM electric
              piano.
            </li>
            <li>
              <strong>Feedback</strong> is the only source of harmonics here that
              isn&apos;t another operator. Wind <span className={styles.ui}>fbk</span>{" "}
              up and it stops being a tone and turns into noise, which is where the
              breaths and cymbals come from. Which operator carries it depends on the
              algorithm, and the panel says which.
            </li>
          </ul>
          <p>
            The four track knobs ride all six operators at once.{" "}
            <span className={styles.ui}>bright</span> raises every modulator&apos;s
            level together, which is the fastest way to hear what a patch can do.{" "}
            <span className={styles.ui}>fbk</span> is the feedback,{" "}
            <span className={styles.ui}>mod dec</span> scales how fast the timbre
            falls away, and <span className={styles.ui}>decay</span> how fast the note
            does.
          </p>
          <p>
            Start from the <span className={styles.ui}>voice</span> dropdown rather
            than from silence: an electric piano, a bass, a bell, brass, a marimba, an
            organ and a pad. Load one and change a single operator level.{" "}
            <span className={styles.ui}>vel</span> makes playing harder raise the
            modulation index, so hard notes come out brighter and not just louder,
            and <span className={styles.ui}>key scale</span> pulls the modulators back
            as you play up the keyboard. Without it the top octave
            screams.
          </p>
        </section>

        <section className={styles.section} id="guitar">
          <h2>The guitar and the bass</h2>
          <p>
            Each models the whole chain a real one goes through: the string, the
            pickup reading it, the amp it runs into and the speaker in front of the
            mic.
          </p>
          <p>
            Both start from a <span className={styles.ui}>tone</span> dropdown of
            famous rigs. Load the nearest one, move a control, hear what that control
            is for. Loading a tone replaces everything including the four track knobs.
          </p>
          <h3>The guitar</h3>
          <p>
            The string has the losses of a real one: the highs die before the
            fundamental does, so a note gets duller as it rings rather than just
            quieter. Where you pick notches harmonics out of it, bridge thin and
            cutting, over the neck round and full, and the pickup notches it again on
            the way out. Choosing a pickup is choosing where its resonance sits. A
            single coil peaks high and glassy, a humbucker low and fat.
          </p>
          <p>
            The four knobs are <span className={styles.ui}>drive</span> (how hard the
            amp is hit, on a log taper like the real pot),{" "}
            <span className={styles.ui}>tone</span> (the knob on the guitar itself,
            not the amp; roll it down with a neck humbucker for the darkest sound the
            instrument has), <span className={styles.ui}>bloom</span> and{" "}
            <span className={styles.ui}>sustain</span>.
          </p>
          <p>
            <span className={styles.ui}>bloom</span> is feedback. The speaker is
            coupled back into the strings, so past a certain point the energy coming
            back beats the string&apos;s own losses and the note stops decaying and
            starts growing. It needs volume: a clean amp barely blooms, a cranked one
            sings. It stops when the note ends, the same way taking your hand off the
            string does. Hold a long step on a high setting and listen to it climb.
          </p>
          <h3>The bass</h3>
          <p>
            Same string, wound and stiffer. Its harmonics sit noticeably sharp of
            where the arithmetic says they should, and that disagreement between the
            pitch and the clank is most of what a bass sounds like. Flatwounds take it
            away along with the high end, which is why records made before about 1970
            sound the way they do. That is the{" "}
            <span className={styles.ui}>roundwound / flatwound</span> select.
          </p>
          <p>
            <span className={styles.ui}>fret</span> is how hard the string is allowed
            to clatter against the fretboard; wound up with the hand control at the
            top, that clatter is slap.{" "}
            <span className={styles.ui}>grind</span> is distortion, but only above the{" "}
            <span className={styles.ui}>xover</span> frequency, with the clean low end
            put back underneath. Distort a bass whole and the bottom vanishes, which
            is why every bass overdrive worth owning works this way.
          </p>
          <p>
            The knobs are <span className={styles.ui}>drive</span>,{" "}
            <span className={styles.ui}>tone</span>,{" "}
            <span className={styles.ui}>comp</span> and{" "}
            <span className={styles.ui}>sustain</span>. Wind{" "}
            <span className={styles.ui}>comp</span> up and the part sits perfectly
            still under everything else.
          </p>
        </section>

        <section className={styles.section} id="subby">
          <h2>Subby</h2>
          <p>
            A monosynth for the bottom two octaves and nothing else. Two notes a
            third apart at 40Hz beat at a rate you feel as lumpiness rather than hear
            as harmony. Last note wins, and{" "}
            <span className={styles.ui}>glide</span> slides into it, either always or
            only when a note arrives while another is still sounding, which is the 808
            slide.
          </p>
          <p>
            Most people cannot hear a 35Hz sine. A phone speaker starts around 500Hz
            and a laptop around 180Hz. The fix is harmonics: generate them and the ear
            rebuilds the fundamental it cannot hear.{" "}
            <span className={styles.ui}>drive</span> is that path. At zero you get a
            genuinely pure sine, which is the right choice when something else in the
            mix is already carrying the note.
          </p>
          <ul>
            <li>
              <strong>The shaping is parallel and high-passed.</strong>{" "}
              <span className={styles.ui}>xover</span> is where it starts; nothing
              below it is ever distorted, so the bottom stays clean however hard you
              drive.
            </li>
            <li>
              <strong><span className={styles.ui}>edge</span></strong> biases the
              signal before the drive, which makes the clipped pulse uneven, and an
              uneven pulse is the even harmonics. Four shapers: tube, fold, fuzz and
              rect.
            </li>
            <li>
              <strong><span className={styles.ui}>drop</span></strong> is the pitch
              envelope, the 808 beater. It spans 40 semitones and lands exactly on the
              note. <span className={styles.ui}>click</span> adds the band of noise
              that is often the only part of the note a small speaker reproduces.
            </li>
            <li>
              <strong><span className={styles.ui}>reso</span></strong> hangs the
              silverbox&apos;s ladder filter above the crossover, with its own envelope
              and its own accent. The acid never reaches the fundamental. At zero the
              whole stage is bypassed.
            </li>
          </ul>
          <p>
            The four knobs are <span className={styles.ui}>drive</span>,{" "}
            <span className={styles.ui}>tone</span>,{" "}
            <span className={styles.ui}>shape</span> and{" "}
            <span className={styles.ui}>decay</span>. The{" "}
            <span className={styles.ui}>tone</span> dropdown loads a complete patch:
            the trap 808, a distorted one, a pure sine, a reese, an acid sub and a dub
            sub.
          </p>
        </section>

        <section className={styles.section} id="sampler">
          <h2>Samples</h2>
          <p>
            Choose <span className={styles.ui}>sampler</span> as a track&apos;s engine
            and it asks for a source: a file from your machine, or one of the bundled
            drum kits. After that the waveform button in the track header opens the
            sample editor.
          </p>
          <ul>
            <li>Trim the start and end, and fade either edge.</li>
            <li>Slice a loop and play the slices from the grid, one per note.</li>
            <li>Fit a loop to the tempo, or leave it at its natural speed.</li>
            <li>Keep pitch locked so a tempo-fitted loop stays in tune, or unlock it and play the sample melodically.</li>
          </ul>
          <p>
            Files you load stay in your browser. They only go anywhere if you save the
            session to an account or make a share link.
          </p>
        </section>

        <section className={styles.section} id="wavetable">
          <h2>The wavetable editor</h2>
          <p>
            With the wavetable engine selected, the waveform button opens an editor
            where you draw the sound. A wavetable is a series of frames, each a single
            cycle of a waveform, and the wave knob sweeps between them.
          </p>
          <ul>
            <li><strong>Draw</strong> straight onto the canvas, or build the shape with the harmonic sliders underneath.</li>
            <li><strong>Load</strong> a starting point: basic shapes, or any of the bundled waveforms.</li>
            <li><strong>Add frames</strong> and the wave knob morphs smoothly between them.</li>
            <li><strong>Unison</strong> stacks up to 7 copies of the voice per note, spread apart by the track&apos;s detune knob.</li>
            <li><strong>Wave scan</strong> sweeps through the frames on its own. Set the speed (free, or in time with the tempo), the direction, and how much of the table it covers. Retrigger restarts the sweep on every note.</li>
          </ul>
        </section>

        <section className={styles.section} id="shaping">
          <h2>Filter, effects and dynamics</h2>
          <p>Each track has its own chain, opened from the buttons under its name.</p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Panel</th><th>What it holds</th></tr>
              </thead>
              <tbody>
                <tr><td>filter</td><td>A low-pass filter with cutoff and resonance. The classic way to open and close a sound.</td></tr>
                <tr><td>env</td><td>An envelope that sweeps the filter on every note: how far it moves, and how it attacks, decays, sustains and releases.</td></tr>
                <tr><td>fx</td><td>The effects chain, below.</td></tr>
                <tr><td>eq</td><td>Three bands, low, middle and high, for sitting a track in the mix.</td></tr>
                <tr><td>comp</td><td>Compression, either on the track itself or ducked by another track, which is how you get a bass pumping under a kick.</td></tr>
              </tbody>
            </table>
          </div>
          <h3>The effects chain</h3>
          <p>
            Effects run in the order they appear in the panel, starting with{" "}
            <span className={styles.ui}>amp</span>.{" "}
            <span className={styles.ui}>drive</span> pushes the signal into everything
            that follows, so fuzz, the wave shaper, tape saturation and the crusher
            all bite harder, and <span className={styles.ui}>out</span> trims the
            level back afterwards. Both sit at unity in the middle.
          </p>
          <p>
            Then come vinyl and cassette (wear, warble and noise), fuzz, ring
            modulation, a wave shaper, a bit crusher, auto-wah, chorus, phaser,
            flanger, pitch shift, delay and reverb. Each has a wet or amount control
            that does nothing at zero, so you can poke around the panel safely. The
            vinyl crackle and cassette hiss only sound while the track is playing, so
            a muted or stopped track is silent.
          </p>
          <p>
            The bit crusher has a <span className={styles.ui}>rate</span> as well as{" "}
            <span className={styles.ui}>bits</span>: the sample rate it runs at, from
            48k down to 250Hz. Bits alone is a noise floor under the sound; rate is
            where the sampler grit comes from, because anything above half of it folds
            back down out of tune with the track.
          </p>
          <p>
            <span className={styles.ui}>glide</span> lives here too. It slides the
            pitch between notes instead of jumping, for portamento leads and basses.
          </p>
        </section>

        <section className={styles.section} id="bus">
          <h2>Fx buses</h2>
          <p>
            Everything in the panels above belongs to one track. So does the mod
            matrix, and so do the automation lanes. An{" "}
            <span className={styles.ui}>fx bus</span> is how several tracks come to
            share them: a track with no instrument, that other tracks are routed
            through on the way to the master.
          </p>
          <p>
            Press <span className={styles.ui}>+ add fx bus</span> under the tracks, or
            pick <span className={styles.ui}>fx bus</span> from any track&apos;s engine
            dropdown. An <span className={styles.ui}>out</span> control then appears on
            every track: point it at the bus and that track arrives there with its own
            sound intact, like an output assignment on a mixer.
          </p>
          <p>
            In every other respect the bus is an ordinary track. Its filter, effects,
            eq and compressor act on everything feeding it at once. Its{" "}
            <span className={styles.ui}>mod</span> panel sweeps the whole group with
            one LFO, its <span className={styles.ui}>aut</span> lanes draw per-step
            movement across all of it, and it can be <a href="#lock">p-locked</a>, so
            the group is drenched in one pattern and dry in the next. A bus can feed
            another bus. Sends that would loop back on themselves are refused.
          </p>
          <p>
            A bus plays no notes, so its step grid and roll are gone.{" "}
            <span className={styles.ui}>mute</span> on a bus cuts the audio passing
            through it, and <span className={styles.ui}>solo</span> on a bus keeps
            whatever feeds it.
          </p>
        </section>

        <section className={styles.section} id="lock">
          <h2>p-lock</h2>
          <p>
            A track normally has one sound and 32 patterns of notes. Move its filter
            and it moves everywhere, because the sound belongs to the track and only
            the notes belong to the pattern.
          </p>
          <p>
            The <span className={styles.ui}>p-lock</span> button changes that for the
            pattern you are on. Locked, that pattern keeps a sound of its own; every
            pattern you leave unlocked carries on sharing the track&apos;s. So the bass
            can be bright and drenched in delay for the chorus while the verse and the
            middle eight are left alone, and those two still move together when you
            tweak them.
          </p>
          <p>
            It is per pattern, so the button changes as you move around, lighting up
            on the patterns you have locked. In chain mode the sound changes arrive
            with the arrangement, on the bar.
          </p>
          <p>Everything about the sound comes along:</p>
          <ul>
            <li>the engine&apos;s own controls, meaning the four knobs and whatever panel it has</li>
            <li>the filter and its envelope</li>
            <li>the effects rack, the eq and the compressor</li>
            <li>the modulation assignments in the mod panel</li>
          </ul>
          <p>
            What stays put is the instrument: the engine, and any sample loaded into
            it. A locked pattern is one instrument played differently, not a different
            instrument. Routing, macro pads and the generator settings stay put too.
          </p>
          <div className={styles.note}>
            Editing on an unlocked pattern edits the shared track sound, so every
            other unlocked pattern follows along. Editing on a locked one only changes
            that pattern. Unlocking hands a pattern back to the shared sound but keeps
            what it had, so locking it again brings it straight back.
          </div>
        </section>

        <section className={styles.section} id="motion">
          <h2>Modulation and automation</h2>
          <p>
            Two ways to make a sound move, both per track.
          </p>
          <h3>mod: continuous</h3>
          <p>
            Assign an LFO to a parameter and it sweeps on its own. Pick the target, a
            shape, an <span className={styles.ui}>amount</span>, and either a free
            speed in hertz or, with <span className={styles.ui}>sync</span> on, a{" "}
            <span className={styles.ui}>length</span>: how long one cycle takes in
            sequencer steps, from half a step up to 64. Filter cutoff is the obvious
            target, but effect amounts and the instrument&apos;s own tone controls work
            just as well.
          </p>
          <p>
            The <span className={styles.ui}>&plusmn;</span> switch beside the amount
            says where that movement sits. On, the modulation swings either side of
            wherever the knob is. Off, it only lifts the parameter above the knob and
            lets it fall back: the same amount of movement, all on one side. Use that
            for anything that should idle where you left it and only open up.
          </p>
          <p>
            <span className={styles.ui}>phase</span> is where in the cycle the shape
            starts. A quarter turn between two LFOs at the same rate gives you a
            circular pan.
          </p>
          <p>
            Two of the six shapes are not waveforms.{" "}
            <span className={styles.ui}>rnd square</span> holds a fresh random value
            for a whole cycle and then jumps to another, which is sample and hold.{" "}
            <span className={styles.ui}>euclid</span> taps the parameter in a
            euclidean rhythm instead of sweeping it. Its length is the{" "}
            <em>step</em> length, so &ldquo;1 step&rdquo; means one ring step per
            sixteenth, and you set the pulses, the cycle length and a rotation the way
            you would on a track. <span className={styles.ui}>decay</span> at zero
            holds each tap for its whole step, which is a gate; turn it up and each tap
            falls away, which is a pluck. It locks to the transport, so the rhythm it
            plays is the rhythm the sequencer is playing. Put it on a filter for a
            gated sweep, on reverb for throws that land on the offbeats, or on a live
            euclid track&apos;s <span className={styles.ui}>rotate</span> and have one
            euclidean pattern turn another.
          </p>
          <h3>aut: per step</h3>
          <p>
            Automation draws a value for each step of the pattern instead. Choose a
            parameter and you get a lane under the grid where every step holds its own
            value: a filter that opens over 16 steps, a delay that only shows up on
            the last beat. Lanes belong to the pattern, so each pattern can move
            differently.
          </p>
          <h3>Right-click any parameter</h3>
          <p>
            To see what is moving one control, right-click the knob, the switch or
            its label. It works anywhere: the instrument row, the filter, effects, eq
            and comp panels, the sample and wavetable editors. You get a small window
            for that one parameter, holding what it does, whatever LFO or automation is
            on it, its macro assignment, and a button to add any of them.
          </p>
          <p>
            A parameter with something on it wears a dot next to its label: green
            for an LFO, blue for an automation lane, grey for a lane you have switched
            off.
          </p>
          <p>
            A knob being driven grows a second needle in that same colour, at
            wherever the LFO or the lane has pushed the parameter right now, while the
            knob itself stays where you left it. The two needles
            together tell you how far it is travelling and where it comes back to.
          </p>
          <div className={styles.note}>
            A parameter takes an LFO, an automation lane or a macro axis, never two.
            Two things writing the same value fight each other, and what you hear is
            one of them dropping out at random. Whichever side is free offers to be
            added; the others tell you what is holding the parameter. Controls that
            are a setting rather than a value, like a waveform or a filter mode, open
            the same window with the explanation and nothing to add.
          </div>
        </section>

        <section className={styles.section} id="macro">
          <h2>Macro pads</h2>
          <p>
            <span className={styles.ui}>macro</span> in the transport opens a set of
            XY pads. Each axis drives a list of parameters, and that list can span
            tracks: one thumb opening the bass filter while ducking the lead&apos;s
            reverb.
          </p>
          <p>Two ways to assign a parameter to an axis:</p>
          <ul>
            <li>
              <strong>Learn.</strong> Press <span className={styles.ui}>learn</span> on
              an axis, then touch any control anywhere in the app. The panel gets out
              of the way while an axis is armed.
            </li>
            <li>
              <strong>The parameter menu.</strong> Right-click a control and assign it
              there, next to its LFO and its lane.
            </li>
          </ul>
          <p>
            Each assignment has a <span className={styles.ui}>from</span> and a{" "}
            <span className={styles.ui}>to</span>, so one axis can open one filter
            across its whole range while barely moving another, and{" "}
            <span className={styles.ui}>flip</span> reverses it.
          </p>
          <p>
            The assigned knobs move as you play the pad. By default the move is
            momentary: let go and everything ramps back to where it was, so nothing is
            committed.{" "}
            <span className={styles.ui}>latch</span> instead leaves the parameters
            where you put them, exactly as if you had moved the knobs yourself, so
            they go into the patch and into a save.
          </p>
          <p>
            Pads are global rather than per track, and they don&apos;t follow p-lock.
            They are saved with the session.
          </p>
        </section>

        <section className={styles.section} id="undo">
          <h2>Undo</h2>
          <p>
            Ctrl/&#8984; Z steps back, Ctrl/&#8984; shift Z steps forward, and the two
            arrows in the transport do the same. It covers the whole session, not just
            the grid: notes, knobs, tracks added and removed, generator settings,
            a pattern you cleared, a session you loaded by accident.
          </p>
          <p>
            A drag counts as one step, so a knob moved in three goes comes back in
            one. Which pattern you are looking at is not part of it, so an undo
            changes the song and never the view. Text fields keep the
            browser&apos;s own undo: retyping a track name is the field&apos;s history,
            not the song&apos;s.
          </p>
          <div className={styles.note}>
            The stack lives in memory and holds the last 100 states. Reloading the tab
            starts a fresh one.
          </div>
        </section>

        <section className={styles.section} id="saving">
          <h2>Saving, sharing and export</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Action</th><th>What happens</th></tr>
              </thead>
              <tbody>
                <tr><td>new</td><td>Blanks the session. Undo brings it back, until the tab goes. If your account has a default template, a new session starts from that instead of from the starter tracks.</td></tr>
                <tr><td>save</td><td>Stores the session to your account. Saving a song you already have keeps the older one: each save is a new version.</td></tr>
                <tr><td>songs</td><td>Your library. Click a title to load it. The row icons are version history, fork, public link, delete, and the two template toggles.</td></tr>
                <tr><td>history</td><td>A song&apos;s versions, drawn as the tree they are. Open any version to hear it again; save after that and the new version branches off the one you opened. <span className={styles.ui}>name</span> labels a version, <span className={styles.ui}>fork</span> copies one into a song of its own.</td></tr>
                <tr><td>template</td><td>Marks a song as a starting point. The first save from an open template makes a new song instead of another version of the template. The second icon makes one the default, which is what <span className={styles.ui}>new</span> loads.</td></tr>
                <tr><td>share</td><td>Makes a link anyone can open. They get a playable copy and your original is untouched.</td></tr>
                <tr><td>public link</td><td>Publishes a song to your profile at <span className={styles.ui}>/u/yourname</span>, where anyone can fork it.</td></tr>
                <tr><td>patch</td><td>The save icon in a track header stores that instrument&apos;s sound, which then shows up under saved patches for any track. Signed in, you can publish patches to the gallery.</td></tr>
                <tr><td>Pattern / Session</td><td>Renders audio and downloads a WAV, either the current pattern or the whole chained arrangement. Recording happens in real time, so a long session takes as long as it plays.</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            Leave the name field blank and the song gets named after what is in it,
            something like <em>basement squelch</em> or <em>soft vapour</em>. The
            adjective comes from the tempo and the key, the noun from whichever engine
            the song is mostly made of. The name appears in the field when the save
            box opens, so you can read it and type over it.
          </p>
          <p>
            A saved song is a tree, not a file that gets overwritten. Every save hangs
            off the version you are working from, so the history keeps a straight line
            while you go forward and branches the moment you open an older version and
            carry on. Forking leaves the tree and starts a new song. Sharing a song
            shares the state you saved, never the versions behind it.
          </p>
          <p>
            Without an account everything lives in the tab, which means a reload or a
            clearing of site data takes it with it. An account is the way to keep it.
          </p>
        </section>

        <section className={styles.section} id="trouble">
          <h2>If something sounds wrong</h2>
          <ul>
            <li>
              <strong>No sound at all.</strong> Press{" "}
              <span className={styles.ui}>play</span> once more, since browsers hold
              audio back until you interact with the page. Then check that nothing
              else is soloed and that the track&apos;s volume is up.
            </li>
            <li>
              <strong>One track is silent.</strong> Look for a soloed track elsewhere,
              a muted one here, or a filter cutoff closed all the way down.
            </li>
            <li>
              <strong>Playback stutters.</strong> Reverb, granular and pitch shift are
              the expensive ones, and a lot of them at once on a slow machine will do
              it. Closing other tabs helps more than you would think.
            </li>
            <li>
              <strong>The playhead looks out of time with what you hear.</strong>{" "}
              Safari can&apos;t report its audio delay, so the display works from an
              estimate. Add <span className={styles.ui}>?vlat=0.2</span> to the address
              to tune it.
            </li>
            <li>
              <strong>An arp isn&apos;t audible.</strong> The note is probably too
              short to fit more than one arp note in. Lengthen it, or choose a faster
              arp rate.
            </li>
            <li>
              <strong>A knob moves but nothing happens.</strong> Check whether an LFO
              or an automation lane owns it. A driven knob is the base the movement
              swings around, and a lane rewrites it every step.
            </li>
            <li>
              <strong>Sound cut out after switching apps.</strong> Click anywhere on
              the page. The audio engine reconnects on your next interaction.
            </li>
          </ul>
        </section>

        <section className={styles.section} id="credits">
          <h2>Credits and licences</h2>
          <p>
            seqbaby is built on other people&apos;s work. Thank you to everyone below,
            and if you use the sounds in something you release, these are the licences
            that travel with them.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Project</th><th>Used for</th><th>Licence</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td><a href="https://tonejs.github.io/" target="_blank" rel="noopener">Tone.js</a></td>
                  <td>Transport and scheduling, and the synth voices behind the drum and analog-mono engines</td>
                  <td>MIT</td>
                </tr>
                <tr>
                  <td><a href="https://github.com/vectorsize/woscillators" target="_blank" rel="noopener">woscillators</a></td>
                  <td>A WebAssembly port of Mutable Instruments&apos; <a href="https://github.com/pichenettes/eurorack" target="_blank" rel="noopener">Plaits</a>, which is the plaits engine group</td>
                  <td>MIT (Plaits: MIT)</td>
                </tr>
                <tr>
                  <td><a href="https://github.com/asb2m10/dexed" target="_blank" rel="noopener">Dexed</a></td>
                  <td>The 32-algorithm table the hexop decodes its operator routings from</td>
                  <td>Apache-2.0</td>
                </tr>
                <tr>
                  <td><a href="https://github.com/KristofferKarlAxelEkstrand/AKWF-FREE" target="_blank" rel="noopener">AKWF (Adventure Kid Waveforms)</a> by Kristoffer Ekstrand</td>
                  <td>The single-cycle waveforms in the wavetable engine and its editor</td>
                  <td>CC0</td>
                </tr>
                <tr>
                  <td><a href="https://github.com/callimero/Lemondrop_Pack" target="_blank" rel="noopener">Lemondrop Pack</a> by callimero</td>
                  <td>The texture library offered to the granular engine</td>
                  <td>GPL-3.0</td>
                </tr>
                <tr>
                  <td><a href="https://github.com/Tonejs/audio" target="_blank" rel="noopener">Tone.js audio samples</a></td>
                  <td>The bundled drum kits in the sampler (techno, CR-78, breakbeat, acoustic, R8)</td>
                  <td>MIT</td>
                </tr>
                <tr>
                  <td><a href="https://nextjs.org/" target="_blank" rel="noopener">Next.js</a> and <a href="https://supabase.com/" target="_blank" rel="noopener">Supabase</a></td>
                  <td>The shell around the studio: accounts, saved songs, the patch gallery and share links</td>
                  <td>MIT / Apache-2.0</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            The emulator engines are original models of those instruments rather than
            recordings of them, and the trademarks belong to their owners.
          </p>
        </section>

        <div className={styles.footer}>
          <a href="/">Back to the studio</a>
        </div>
      </div>
    </div>
  );
}
