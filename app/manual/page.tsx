import type { Metadata } from "next";
import styles from "./manual.module.css";

export const metadata: Metadata = {
  title: "seqbaby manual",
  description: "How to use seqbaby: transport, patterns, tracks, engines, the piano roll, effects, saving and sharing.",
};

const SECTIONS = [
  ["start", "Getting started"],
  ["transport", "Transport"],
  ["patterns", "Patterns"],
  ["tracks", "Tracks"],
  ["steps", "The step grid"],
  ["roll", "The piano roll"],
  ["step-editor", "The step editor"],
  ["keyboard", "Playing from your keyboard"],
  ["scale", "Scale and chords"],
  ["engines", "Sound engines"],
  ["tb303", "The 303"],
  ["virus", "The virus"],
  ["dx7", "The dx7"],
  ["guitar", "The guitar and the bass"],
  ["sampler", "Samples"],
  ["wavetable", "The wavetable editor"],
  ["shaping", "Filter, effects and dynamics"],
  ["bus", "Fx buses"],
  ["lock", "p-lock"],
  ["motion", "Modulation and automation"],
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
          seqbaby is a step sequencer that runs in your browser. You build patterns
          on a grid, each track plays its own instrument, and you pile effects and
          movement on top. There&apos;s nothing to install, and nothing leaves your
          machine unless you save or share it.
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
            until you&apos;ve interacted with the page, so the first press is really
            just permission. If you hear nothing, press it again.
          </p>
          <p>
            A new session opens with a few drum tracks already going. Click any cell
            in a track&apos;s row of squares to add or remove a hit, and you&apos;re
            sequencing. After that:
          </p>
          <ul>
            <li>The dropdown next to a track&apos;s name changes what it sounds like.</li>
            <li><span className={styles.ui}>+ add track</span> at the bottom gets you another instrument.</li>
            <li>The numbered buttons at the top are 32 pattern slots to move between.</li>
          </ul>
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
                <tr><td>record</td><td>With the sequencer running, anything you play on your computer keyboard gets written into the active track.</td></tr>
                <tr><td>capture</td><td>Writes the phrase you just played into the active track even though you weren&apos;t recording. It keeps the last 32 seconds, takes the run of notes since your last pause, and keeps the lengths you actually held.</td></tr>
                <tr><td>bpm</td><td>Tempo. Type a number, or drag the field up and down.</td></tr>
                <tr><td>swing</td><td>Pushes every second step later, from dead straight to a heavy shuffle.</td></tr>
                <tr><td>metronome</td><td>A click on each downbeat, for playing along. It never ends up in an export.</td></tr>
                <tr><td>meter</td><td>Output level, over on the right. If it sits pinned at the top, turn some tracks down.</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            The second row is the keyboard-performance strip: scale, octave, chord
            and arp. That lot is covered under{" "}
            <a href="#keyboard">playing from your keyboard</a>.
          </p>
        </section>

        <section className={styles.section} id="patterns">
          <h2>Patterns</h2>
          <p>
            Every session has 32 pattern slots, numbered 1 to 32. Click a number to
            switch to it; the one you&apos;re editing is outlined. Empty slots are
            blank canvases, so one slot per section (intro, verse, chorus) is an easy
            way to build an arrangement.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Control</th><th>What it does</th></tr>
              </thead>
              <tbody>
                <tr><td>repeat / chain</td><td>Repeat loops the current pattern forever. Chain plays your non-empty patterns in order, like a song.</td></tr>
                <tr><td>immediate / finish</td><td>Whether clicking another pattern switches straight away or waits out the current bar.</td></tr>
                <tr><td>dup</td><td>Copies this pattern into the next free slot. The usual way to start a variation.</td></tr>
                <tr><td>drag a number</td><td>Drops a copy of that pattern onto any other slot and takes you there to work on it. In finish mode while playing it waits for the bar, like any other switch.</td></tr>
                <tr><td>sig</td><td>Time signature for this pattern, anywhere from 4/4 to 7/8.</td></tr>
                <tr><td>rep</td><td>In chain mode, how many bars this pattern gets before the next one.</td></tr>
              </tbody>
            </table>
          </div>
          <div className={styles.note}>
            Patterns hold notes, not sounds. Switching leaves your instruments,
            effects and mixer settings exactly where they were, because those belong
            to the track. If you want the opposite, a track&apos;s{" "}
            <span className={styles.ui}>p-lock</span> button gives it a sound of its
            own in <em>this</em> pattern, so one track can be a different instrument
            in the chorus than in the verse. See <a href="#lock">p-lock</a>.
          </div>
        </section>

        <section className={styles.section} id="tracks">
          <h2>Tracks</h2>
          <p>
            A track is one instrument plus its pattern. The header row has its name,
            its engine (the instrument) and how long its pattern is.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Control</th><th>What it does</th></tr>
              </thead>
              <tbody>
                <tr><td>len</td><td>How many steps this track loops over. They don&apos;t have to match: a 12-step track against a 16-step one drifts in and out of phase.</td></tr>
                <tr><td>+1 x2 x4 /2 /4</td><td>Grow or shrink the pattern. Growing copies what&apos;s already there.</td></tr>
                <tr><td>spd</td><td>Runs this track faster or slower than the rest, from 1/16 up to 16 times.</td></tr>
                <tr><td>vol</td><td>Track volume, with its level meter sitting behind the slider.</td></tr>
                <tr><td>solo / mute</td><td>Hear only this track, or silence it.</td></tr>
                <tr><td>out</td><td>Where the track goes: straight to the master, or into an fx bus. It only shows up once a bus exists. See <a href="#bus">fx buses</a>.</td></tr>
                <tr><td>p-lock</td><td>Gives this track a sound of its own on the pattern you&apos;re on. It&apos;s per pattern, so it changes as you move around. See <a href="#lock">below</a>.</td></tr>
                <tr><td>clear</td><td>Empties this pattern on this track.</td></tr>
                <tr><td>dice</td><td>Rolls a new pattern. Keep pressing until one sticks. The fill level behind the icon is how busy the results come out; drag the dice up or down to set it.</td></tr>
                <tr><td>ring</td><td>Euclidean rhythms: a number of hits spread as evenly as possible over a cycle, which covers a startling amount of the world&apos;s drumming. Set the hits, the cycle length and a rotation, and the cycle tiles across the track. <strong>Write to pattern</strong> prints it as ordinary steps you can edit afterwards. <strong>Live</strong> has the track generate its rhythm as it plays without writing anything, so the three counts can take an LFO, an automation lane or a macro pad. Turn it off and the pattern you had is still there. While live is on the grid shows what&apos;s being generated, and won&apos;t let you edit it.</td></tr>
                <tr><td>dup / remove</td><td>Copy the whole track, sound and all, or delete it.</td></tr>
                <tr><td>oct / semi</td><td>Transposes everything in the pattern up or down.</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            The second row of buttons (<span className={styles.ui}>roll</span>,{" "}
            <span className={styles.ui}>filter</span>, <span className={styles.ui}>env</span>,{" "}
            <span className={styles.ui}>fx</span>, <span className={styles.ui}>eq</span>,{" "}
            <span className={styles.ui}>comp</span>, <span className={styles.ui}>mod</span>,{" "}
            <span className={styles.ui}>aut</span>) opens the panels described in{" "}
            <a href="#shaping">filter, effects and dynamics</a> and{" "}
            <a href="#motion">modulation and automation</a>.
          </p>
          <p>
            If you run into a control you don&apos;t recognise, in a track row or in
            any of those panels, <a href="#motion">right-click it</a>. You get what it
            does and whatever movement is on it.
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
            <li><strong>Right-click</strong>, or press and hold on a touchscreen, to open the step editor.</li>
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
            up the side, steps across. It&apos;s the best place to write a melody, and
            the only place to stack notes into a chord you voice by hand.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Gesture</th><th>Result</th></tr>
              </thead>
              <tbody>
                <tr><td>Click empty space</td><td>Adds a one-step note. Keep dragging right to lengthen it as you go.</td></tr>
                <tr><td>Drag a note&apos;s middle</td><td>Moves the whole note, left and right in time, up and down in pitch. The length stays put.</td></tr>
                <tr><td>Drag a note&apos;s edge</td><td>Resizes it. Left edge moves the start, right edge moves the end.</td></tr>
                <tr><td>Drag a one-step note</td><td>Its single cell does both jobs: the thin right-hand sliver resizes, the rest moves. The cursor tells you which one you&apos;re on.</td></tr>
                <tr><td>Double-click a note</td><td>Deletes it. On a stacked note it only deletes the row you clicked.</td></tr>
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
            one starts. To hear pitches together, stack them on the same step or use a
            chord in the step editor.
          </div>
        </section>

        <section className={styles.section} id="step-editor">
          <h2>The step editor</h2>
          <p>
            Right-click any step for everything that step can do beyond pitch and
            length.
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

        <section className={styles.section} id="keyboard">
          <h2>Playing from your keyboard</h2>
          <p>
            On a desktop machine your computer keyboard always plays the active track,
            which is the last one you clicked and the one with the outline. Typing in a
            text box is safe: note keys only fire when no text field has focus.
          </p>
          <p>
            The layout is a piano. The home row is the white keys and the row above it
            holds the black keys.
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
          <p>There are two ways to get what you play into a pattern.</p>
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
            and minor modes, pentatonics, blues, a handful of exotic scales, and some
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
                <tr><td>Emulators</td><td>The 303, modelled from the acid machine&apos;s own circuits down to the diode-ladder filter and the accent behaviour (<a href="#tb303">more below</a>). The virus, a polyphonic take on the digital synth that defined trance and drum and bass, with its two routable filters and its hypersaw (<a href="#virus">below</a>). The dx7, six sine operators through the machine&apos;s own 32 algorithms (<a href="#dx7">below</a>). An electric guitar and an electric bass, each modelled as a whole rig (string, pickup, amp, cab) with a dropdown of famous tones (<a href="#guitar">below</a>). Then five monosynth voices in the spirit of classic hardware: MiniBrute, Moog, Juno, Rhodes and Prophet.</td></tr>
                <tr><td>texture</td><td>A granular engine that plays a sample as a cloud of tiny grains.</td></tr>
                <tr><td>wavetable</td><td>A wavetable synth with its own <a href="#wavetable">editor</a>.</td></tr>
                <tr><td>sampler</td><td>Your own audio, or one of the bundled kits. See <a href="#sampler">samples</a>.</td></tr>
                <tr><td>saved patches</td><td>Sounds you&apos;ve saved yourself.</td></tr>
                <tr><td>midi</td><td>Sends notes to external hardware or software instead of making a sound itself.</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            The four sliders under the name are that instrument&apos;s main tone
            controls: <span className={styles.ui}>harm</span>,{" "}
            <span className={styles.ui}>timb</span>,{" "}
            <span className={styles.ui}>morph</span> and{" "}
            <span className={styles.ui}>decay</span> on a Plaits model, something else
            on the next engine. The labels change with the engine so they always say
            what they actually do.
          </p>
        </section>

        <section className={styles.section} id="tb303">
          <h2>The 303</h2>
          <p>
            The <span className={styles.ui}>303</span> engine models the machine
            instead of approximating it with a filter preset, so it answers a pattern
            the way the original does. Its four sliders are the panel knobs:{" "}
            <span className={styles.ui}>cutoff</span>,{" "}
            <span className={styles.ui}>reso</span>,{" "}
            <span className={styles.ui}>env mod</span> and{" "}
            <span className={styles.ui}>decay</span>. Next to them are the waveform
            switch, the accent depth and tuning.
          </p>
          <p>How you play it comes down to three behaviours:</p>
          <ul>
            <li>
              <strong>Accent comes from step velocity.</strong> Push a step past about
              two-thirds and it accents: louder, brighter, filter decay forced short.
              With the resonance up, consecutive accents stack into a rising squelch
              rather than resetting each time, and that pile-up is the sound of an
              acid line.
            </li>
            <li>
              <strong>Slide comes from note length.</strong> Draw a step longer than
              one cell and the note after it slides out of it: the pitch glides across
              and the envelopes never retrigger.
            </li>
            <li>
              <strong>Plain steps get clipped short</strong>, a little over half the
              step, which is what makes a 303 part drive instead of running together.
              Lengthen a note if you want it to hold.
            </li>
          </ul>
          <p>
            The filter thins out as you wind the resonance up, same as the real one.
            That&apos;s why acid records run a 303 into a distortion pedal, and you can
            do the same from the track&apos;s <span className={styles.ui}>fx</span>{" "}
            panel.
          </p>
        </section>

        <section className={styles.section} id="virus">
          <h2>The virus</h2>
          <p>
            Where the 303 is one idea done perfectly, the virus is a big polyphonic
            synth built for movement. Its four sliders are{" "}
            <span className={styles.ui}>cutoff</span>,{" "}
            <span className={styles.ui}>reso</span>,{" "}
            <span className={styles.ui}>shape</span> and{" "}
            <span className={styles.ui}>decay</span>. The four beside them are the
            levels of osc 1, osc 2, the sub and the noise. Everything else lives in
            the three rows underneath.
          </p>
          <p>These are the ones to reach for first:</p>
          <ul>
            <li>
              <strong>Shape</strong> is one continuous morph from sine through
              triangle and saw to pulse, and at the very top the pulse width slider
              takes over. Sweep it and the tone changes character, not just
              brightness.
            </li>
            <li>
              <strong>Unison</strong> is the hypersaw. Each note plays up to eight
              detuned copies of the whole oscillator section, spread across the
              stereo field. Two or three thickens things up; eight with the detune
              wound on is the wide trance sound.
            </li>
            <li>
              <strong>Two filters, not one.</strong> Each can be a low pass, high
              pass, band pass or notch, and you choose how they connect: in series,
              in parallel, or split so filter 1 plays the left ear and filter 2 the
              right. A low pass into a high pass in series gives you a band pass you
              can sweep from both ends.
            </li>
            <li>
              <strong>Saturation sits between them.</strong> Filter 2 gets to tidy up
              whatever the saturator did to filter 1&apos;s output, so you can be
              filthy and controlled at the same time. It runs from a gentle warmth
              through hard clipping to a bit reducer and a rate reducer.
            </li>
          </ul>
          <p>
            Sync is the other one to know about. Turn it on and osc 2 is forced to osc
            1&apos;s pitch, so dragging the <span className={styles.ui}>semi</span>{" "}
            slider, or automating it, gives you the classic tearing sync lead.
          </p>
        </section>

        <section className={styles.section} id="dx7">
          <h2>The dx7</h2>
          <p>
            Six sine waves. That&apos;s the whole instrument: no filter, no sub
            oscillator, nothing else. What comes out depends entirely on which sines
            are wired into which, and how hard. The panel is the same six rows
            whatever you&apos;re building, one row per operator, each with its level,
            its frequency as a ratio of the note, and its own envelope.
          </p>
          <ul>
            <li>
              <strong>The algorithm is the wiring.</strong> There are 32 of them and
              you can&apos;t make your own, which was true of the machine too. The
              dropdown draws each one, so <span className={styles.ui}>1&larr;2</span>{" "}
              means operator 2 modulates operator 1. Beside it the panel marks the{" "}
              <em>carriers</em>, the operators that reach your ears, whose level is
              simply volume. Everything else is a modulator, and its level is how hard
              it bends the operator below it. Carrier rows are highlighted so you can
              always see which is which.
            </li>
            <li>
              <strong>Level is exponential, and level is everything.</strong> A
              modulator at half its slider is a sixteenth of full scale, so nearly all
              the interesting range lives in the top quarter. Nudging one modulator
              level is how you program this thing.
            </li>
            <li>
              <strong>Every operator has its own envelope</strong>, so the timbre has
              an envelope. A modulator that decays fast under a carrier that
              doesn&apos;t is a struck sound. That&apos;s the trick behind an FM
              electric piano, and it&apos;s why the dx7 made a noise nothing before it
              could.
            </li>
            <li>
              <strong>Feedback</strong> is the only source of harmonics in the machine
              that isn&apos;t another operator. Wind the{" "}
              <span className={styles.ui}>fbk</span> slider up and it stops being a
              tone and turns into noise, which is where the breaths and cymbals come
              from. Which operator carries it depends on the algorithm, and the panel
              says which.
            </li>
          </ul>
          <p>
            The four track sliders ride all six operators at once.{" "}
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
            organ and a pad. Load one, change a single operator level, and
            you&apos;re programming a dx7. Two more controls are worth finding.{" "}
            <span className={styles.ui}>vel</span> makes playing harder raise the
            modulation index, so hard notes come out brighter and not just louder, and{" "}
            <span className={styles.ui}>key scale</span> pulls the modulators back as
            you play up the keyboard. Without it the top octave screams.
          </p>
        </section>

        <section className={styles.section} id="guitar">
          <h2>The guitar and the bass</h2>
          <p>
            Neither of these is a plucked-string preset. Each models the whole chain a
            real one goes through: the string, the pickup reading it, the amp it runs
            into and the speaker in front of the mic. On these instruments the chain
            is the sound.
          </p>
          <p>
            Both start from a <span className={styles.ui}>tone</span> dropdown of
            famous rigs, and that&apos;s the sane way in. Load the nearest one, move a
            control, hear what that control is for. Loading a tone replaces everything
            including the four track sliders, so nothing of the last one is left
            hanging around.
          </p>
          <h3>The guitar</h3>
          <p>
            The string is a waveguide with the losses of a real one: the highs die
            before the fundamental does, so a note gets duller as it rings rather than
            just quieter. Where you pick notches harmonics out of it, bridge thin and
            cutting, over the neck round and full, and the pickup notches it again on
            the way out. Choosing a pickup is really choosing where its resonance
            sits. A single coil peaks high and glassy, a humbucker low and fat.
          </p>
          <p>
            The four track sliders are <span className={styles.ui}>drive</span> (how
            hard the amp is hit, on a log taper like the real pot),{" "}
            <span className={styles.ui}>tone</span> (the knob on the guitar itself,
            not the amp; roll it all the way down with a neck humbucker for the
            darkest sound the instrument has),{" "}
            <span className={styles.ui}>bloom</span> and{" "}
            <span className={styles.ui}>sustain</span>.
          </p>
          <p>
            <span className={styles.ui}>bloom</span> is feedback, and it helps to know
            what it&apos;s doing. The speaker is coupled back into the strings, so past
            a certain point the energy coming back beats the string&apos;s own losses
            and the note stops decaying and starts growing. It needs volume: a clean
            amp barely blooms, a cranked one sings. It also stops when the note ends,
            the same way taking your hand off the string does. Hold a long step on a
            high setting and listen to it climb.
          </p>
          <h3>The bass</h3>
          <p>
            Same string, wound and stiffer. Its harmonics sit noticeably sharp of
            where the arithmetic says they should, and that disagreement between the
            pitch and the clank is most of what a bass sounds like. Flatwounds take it
            away along with the high end, which is why records made before about 1970
            sound the way they do. That&apos;s the{" "}
            <span className={styles.ui}>roundwound / flatwound</span> select.
          </p>
          <p>
            Two panel controls are worth finding.{" "}
            <span className={styles.ui}>fret</span> is how hard the string is allowed
            to clatter against the fretboard; wound up with the hand control at the
            top, that clatter is slap.{" "}
            <span className={styles.ui}>grind</span> is distortion, but only above the{" "}
            <span className={styles.ui}>xover</span> frequency, with the clean low end
            put back underneath. Distort a bass whole and the bottom vanishes, which
            is why every bass overdrive worth owning works this way.
          </p>
          <p>
            The sliders are <span className={styles.ui}>drive</span>,{" "}
            <span className={styles.ui}>tone</span>,{" "}
            <span className={styles.ui}>comp</span> and{" "}
            <span className={styles.ui}>sustain</span>. Compression gets a slider of
            its own because a bass part sitting perfectly still under everything else
            is a compressor doing that, and it&apos;s as much the sound as the amp is.
          </p>
        </section>

        <section className={styles.section} id="sampler">
          <h2>Samples</h2>
          <p>
            Choose <span className={styles.ui}>sampler</span> as a track&apos;s engine
            and it asks you for a source: a file from your machine, or one of the
            bundled drum kits. After that the waveform button in the track header
            opens the sample editor.
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
            where you draw the sound itself. A wavetable is a series of frames, each a
            single cycle of a waveform, and the wave slider sweeps between them.
          </p>
          <ul>
            <li><strong>Draw</strong> straight onto the canvas, or build the shape with the harmonic sliders underneath.</li>
            <li><strong>Load</strong> a starting point: basic shapes, or any of the bundled waveforms.</li>
            <li><strong>Add frames</strong> and the wave slider morphs smoothly between them.</li>
            <li><strong>Unison</strong> stacks up to 7 copies of the voice per note, spread apart by the track&apos;s detune slider, for a wide supersaw sound.</li>
            <li><strong>Wave scan</strong> sweeps through the frames on its own. Set the speed (free, or in time with the tempo), the direction, and how much of the table it covers. Retrigger restarts the sweep on every note instead of letting it run continuously.</li>
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
            that does nothing at zero, so you can poke around the panel safely.
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
            share them: it&apos;s a track with no instrument in it, and other tracks
            are routed through it instead of going straight to the master.
          </p>
          <p>
            Press <span className={styles.ui}>+ add fx bus</span> under the tracks, or
            pick <span className={styles.ui}>fx bus</span> from any track&apos;s engine
            dropdown. An <span className={styles.ui}>out</span> control then appears on
            every track: point it at the bus and that track arrives there with its own
            sound intact, exactly like an output assignment on a mixer.
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
            through it, since everywhere else mute just withholds a track&apos;s notes
            and a bus hasn&apos;t got any. <span className={styles.ui}>solo</span> on a
            bus keeps whatever feeds it, which is what you meant by soloing it.
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
            The <span className={styles.ui}>p-lock</span> button in a track&apos;s
            button row changes that for the pattern you&apos;re on. Locked, that
            pattern keeps a sound of its own; every pattern you leave unlocked carries
            on sharing the track&apos;s. So the bass can be bright and drenched in
            delay for the chorus while the verse and the middle eight are left alone,
            and those two still move together when you tweak them.
          </p>
          <p>
            It&apos;s per pattern, so the button changes as you move around, lighting
            up on the patterns you&apos;ve locked. In chain mode the sound changes
            arrive with the arrangement, on the bar.
          </p>
          <p>Everything about the sound comes along:</p>
          <ul>
            <li>the engine&apos;s own controls, meaning the four sliders and whatever panel it has</li>
            <li>the filter and its envelope</li>
            <li>the effects rack, the eq and the compressor</li>
            <li>the modulation assignments in the mod panel</li>
          </ul>
          <p>
            What stays put is the instrument: the engine, and any sample loaded into
            it. A locked pattern is one instrument played differently, not a different
            instrument.
          </p>
          <div className={styles.note}>
            Editing on an unlocked pattern edits the shared track sound, so every other
            unlocked pattern follows along. Editing on a locked one only changes that
            pattern. Unlocking hands a pattern back to the shared sound but keeps what
            it had, so locking it again brings it straight back.
          </div>
        </section>

        <section className={styles.section} id="motion">
          <h2>Modulation and automation</h2>
          <p>
            Two ways to make a sound move. Both are per track, and both are worth using
            on anything that repeats for long.
          </p>
          <h3>mod: continuous</h3>
          <p>
            Assign an LFO to a parameter and it sweeps back and forth on its own. Pick
            the target, a shape, an <span className={styles.ui}>amount</span>, and
            either a free speed in hertz or, with{" "}
            <span className={styles.ui}>sync</span> on, a{" "}
            <span className={styles.ui}>length</span>: how long one cycle takes in
            sequencer steps, from half a step up to 64, so it stays in time. Filter
            cutoff is the obvious target, but effect amounts and the instrument&apos;s
            own tone controls work just as well.
          </p>
          <p>
            The <span className={styles.ui}>&plusmn;</span> switch beside the amount
            says where that movement sits. On, the modulation swings either side of
            wherever the knob is. Off, it only lifts the parameter above the knob and
            lets it fall back: the same amount of movement, all of it on one side.
            That&apos;s what you want for anything that should idle where you left it
            and only open up.
          </p>
          <p>
            The fifth shape, <span className={styles.ui}>euclid</span>, is a rhythm
            rather than a waveform. Instead of sweeping, the parameter gets tapped in a
            euclidean pattern. The length becomes the <em>step</em> length, so
            &ldquo;1 step&rdquo; means one ring step per sixteenth, and you set the
            pulses, the cycle length and a rotation the way you would on a track.{" "}
            <span className={styles.ui}>decay</span> at zero holds each tap for its
            whole step, which is a gate; turn it up and each tap falls away instead,
            which is a pluck. Taps lift the parameter off wherever its knob sits and
            let it drop back, so the knob stays the base. That&apos;s why this shape
            starts with <span className={styles.ui}>&plusmn;</span> off; turn it on and
            rests pull the parameter down as far as taps push it up. It locks to the
            transport, so the rhythm it plays is the rhythm the sequencer is playing.
            Put it on a filter for a gated sweep, on reverb for throws that land on the
            offbeats, or on a live euclid track&apos;s{" "}
            <span className={styles.ui}>rotate</span> and have one euclidean pattern
            turn another.
          </p>
          <h3>aut: per step</h3>
          <p>
            Automation draws a value for each step of the pattern instead. Choose a
            parameter and you get a lane under the grid where every step holds its own
            value: a filter that opens over 16 steps, a delay that only shows up on the
            last beat. Lanes belong to the pattern, so each pattern can move
            differently.
          </p>
          <h3>Right-click any parameter</h3>
          <p>
            The two panels above list a whole track at once, which is the long way
            round when all you want to know is what&apos;s moving <em>this</em>{" "}
            control. Right-click a slider, a switch or its label instead. It works
            anywhere: the instrument row, the filter, effects, eq and comp panels, the
            sample and wavetable editors. You get a small window for that one
            parameter, holding what it does, whatever LFO or automation is on it, and
            a button to add either. It&apos;s also the quickest way to learn an
            unfamiliar control, since the explanation is the first thing in the
            window.
          </p>
          <p>
            You don&apos;t have to go looking, either. A parameter with something on it
            wears a dot next to its label: green for an LFO, blue for an automation
            lane, grey for a lane you&apos;ve switched off. Scan a track and you can see
            where its movement is coming from.
          </p>
          <div className={styles.note}>
            A parameter takes an LFO or an automation lane, not both. Two things
            writing the same value fight each other, and what you hear is one of them
            dropping out at random. Whichever side is free offers to be added; the
            other tells you what&apos;s holding the parameter, and removing that frees
            it up again. Controls that are a setting rather than a value, like a
            waveform or a filter mode or a routing switch, open the same window with
            the explanation and nothing to add.
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
                <tr><td>session</td><td>Saves the whole session, every track, pattern and setting, into this browser.</td></tr>
                <tr><td>save (signed in)</td><td>Stores the session to your account, so you can open it anywhere and keep a library of songs.</td></tr>
                <tr><td>share</td><td>Makes a link anyone can open. They get a playable copy and your original is untouched.</td></tr>
                <tr><td>patch</td><td>The save icon in a track header stores that instrument&apos;s sound, which then shows up under saved patches for any track. Signed in, you can publish patches to the gallery for other people to use.</td></tr>
                <tr><td>Pattern / Session</td><td>Renders audio and downloads a WAV, either the current pattern or the whole chained arrangement. Recording happens in real time, so a long session takes as long as it plays.</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            Without an account everything lives in your browser, which means clearing
            site data clears your work. An account is the way to keep it.
          </p>
        </section>

        <section className={styles.section} id="trouble">
          <h2>If something sounds wrong</h2>
          <ul>
            <li>
              <strong>No sound at all.</strong> Press{" "}
              <span className={styles.ui}>play</span> once more, since browsers hold
              audio back until you interact with the page. Then check that nothing else
              is soloed and that the track&apos;s volume is up.
            </li>
            <li>
              <strong>One track is silent.</strong> Look for a soloed track elsewhere,
              a muted one here, or a filter cutoff closed all the way down.
            </li>
            <li>
              <strong>Playback stutters.</strong> Reverb, granular and pitch shift are
              the expensive ones, and a lot of them at once on a slow machine will do
              it. Closing other tabs helps more than you&apos;d think.
            </li>
            <li>
              <strong>The playhead looks out of time with what you hear.</strong>{" "}
              Safari can&apos;t report its audio delay, so the display is working from
              an estimate. Add <span className={styles.ui}>?vlat=0.2</span> to the
              address to tune it to your machine.
            </li>
            <li>
              <strong>An arp isn&apos;t audible.</strong> The note is probably too short
              to fit more than one arp note in. Lengthen it, or choose a faster arp
              rate.
            </li>
            <li>
              <strong>Sound cut out after switching apps.</strong> Click anywhere on the
              page. The audio engine reconnects on your next interaction.
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
                  <td>Transport and scheduling, and the synth voices behind the drum, emulator and 303 engines</td>
                  <td>MIT</td>
                </tr>
                <tr>
                  <td><a href="https://github.com/vectorsize/woscillators" target="_blank" rel="noopener">woscillators</a></td>
                  <td>A WebAssembly port of Mutable Instruments&apos; <a href="https://github.com/pichenettes/eurorack" target="_blank" rel="noopener">Plaits</a>, which is the plaits engine group</td>
                  <td>MIT (Plaits: MIT)</td>
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
                  <td>The bundled drum kits in the sampler (808, CR-78, breakbeat, acoustic)</td>
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
            The 808 and 909 engines are original models of those machines&apos;
            circuits rather than recordings of them, and Roland&apos;s trademarks
            belong to Roland.
          </p>
        </section>

        <div className={styles.footer}>
          <a href="/">Back to the studio</a>
        </div>
      </div>
    </div>
  );
}
