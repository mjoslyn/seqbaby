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
          seqbaby is a step sequencer that runs entirely in your browser. You build
          patterns on a grid, each track playing its own instrument, and layer
          effects and movement on top. Nothing is installed and nothing is uploaded
          unless you choose to save or share.
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
            until you interact with the page, so the first press is what switches the
            sound on — if you hear nothing at first, press it once more.
          </p>
          <p>
            A new session opens with a few drum tracks already playing. Click any cell
            in a track&apos;s row of squares to add or remove a hit, and you are
            sequencing. From there:
          </p>
          <ul>
            <li>Change what a track sounds like with the dropdown next to its name.</li>
            <li>Click <span className={styles.ui}>+ add track</span> at the bottom for another instrument.</li>
            <li>Use the numbered buttons at the top to move between 32 pattern slots.</li>
          </ul>
        </section>

        <section className={styles.section} id="transport">
          <h2>Transport</h2>
          <p>The bar across the top controls playback for everything.</p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Control</th><th>What it does</th></tr>
              </thead>
              <tbody>
                <tr><td>play</td><td>Starts and stops the sequencer. Playback always restarts from the top.</td></tr>
                <tr><td>record</td><td>While the sequencer runs, notes you play on your computer keyboard are written into the active track.</td></tr>
                <tr><td>capture</td><td>Writes the phrase you just played into the active track, even though you were not recording. It keeps the last 32 seconds and takes the run of notes after the most recent pause, with the note lengths you actually held.</td></tr>
                <tr><td>bpm</td><td>Tempo. Type a number, or drag the field up and down.</td></tr>
                <tr><td>swing</td><td>Delays every second step, from straight to a heavy shuffle.</td></tr>
                <tr><td>metronome</td><td>A click on each downbeat, for playing along. It is never included in an export.</td></tr>
                <tr><td>meter</td><td>The bar at the far right shows the output level. If it sits at the very top, turn some tracks down.</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            The second row is the keyboard-performance strip — scale, octave, chord
            and arp. It is covered under <a href="#keyboard">playing from your keyboard</a>.
          </p>
        </section>

        <section className={styles.section} id="patterns">
          <h2>Patterns</h2>
          <p>
            Every session holds 32 pattern slots, numbered 1–32. Click a number to
            switch to it; the one you are editing is outlined. An empty slot is a
            blank canvas, so a slot per section (intro, verse, chorus) is a good way
            to build an arrangement.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Control</th><th>What it does</th></tr>
              </thead>
              <tbody>
                <tr><td>repeat / chain</td><td>Repeat loops the current pattern forever. Chain plays through your non-empty patterns in order, like a song.</td></tr>
                <tr><td>immediate / finish</td><td>Whether clicking another pattern switches instantly or waits for the current bar to finish.</td></tr>
                <tr><td>dup</td><td>Copies this pattern into the next free slot — the usual way to make a variation.</td></tr>
                <tr><td>drag a number</td><td>Drops a copy of that pattern onto any other slot, and takes you there to work on it. (While playing in finish mode it waits for the bar, like any other switch.)</td></tr>
                <tr><td>sig</td><td>Time signature for this pattern, from 4/4 to 7/8.</td></tr>
                <tr><td>rep</td><td>In chain mode, how many bars this pattern plays before moving on.</td></tr>
              </tbody>
            </table>
          </div>
          <div className={styles.note}>
            Patterns store notes, not sounds: switching patterns leaves your
            instruments, effects and mixer settings alone, because those belong to
            the track. Unless you want otherwise — a track&apos;s{" "}
            <span className={styles.ui}>p-lock</span> button gives it a sound of its
            own in <em>this</em> pattern, so one track can be a different instrument
            in the chorus than in the verse. See <a href="#lock">p-lock</a>.
          </div>
        </section>

        <section className={styles.section} id="tracks">
          <h2>Tracks</h2>
          <p>
            A track is one instrument plus its pattern. The header row holds its name,
            its engine (the instrument), and the length of its pattern.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Control</th><th>What it does</th></tr>
              </thead>
              <tbody>
                <tr><td>len</td><td>How many steps this track loops over. Tracks can differ — a 12-step track against a 16-step one drifts in and out of phase.</td></tr>
                <tr><td>+1 x2 x4 /2 /4</td><td>Grow or shrink the pattern. Growing copies what is already there.</td></tr>
                <tr><td>spd</td><td>Plays this track faster or slower than the rest, from 1/16 to 16 times.</td></tr>
                <tr><td>vol</td><td>Track volume, with its level meter behind the slider.</td></tr>
                <tr><td>solo / mute</td><td>Hear only this track, or silence it.</td></tr>
                <tr><td>out</td><td>Where the track goes: straight to the master, or into an fx bus. Only appears once a bus exists. See <a href="#bus">fx buses</a>.</td></tr>
                <tr><td>p-lock</td><td>Gives this track a sound of its own in the pattern you are on. Per pattern, so it changes as you move between them. See <a href="#lock">below</a>.</td></tr>
                <tr><td>clear</td><td>Empties this pattern on this track.</td></tr>
                <tr><td>dice</td><td>Generates a new pattern. Keep pressing until something sticks. The fill level behind the icon is how busy the roll comes out — drag the dice up or down to set it.</td></tr>
                <tr><td>ring</td><td>Euclidean rhythms — spreads a number of hits as evenly as possible over a cycle, which is where most of the world&rsquo;s rhythms live. Set the hits, the cycle length and a rotation; the cycle tiles across the track. <strong>Write to pattern</strong> prints it as ordinary steps. <strong>Live</strong> instead has the track generate its rhythm as it plays, without writing anything — so the three counts can take an LFO, an automation lane or a macro pad, and turning it off gives you back the pattern you had. The step grid shows what is being generated and goes read-only while live is on.</td></tr>
                <tr><td>dup / remove</td><td>Copy the whole track (sound and all), or delete it.</td></tr>
                <tr><td>oct / semi</td><td>Transposes everything in the pattern up or down.</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            The second row of buttons — <span className={styles.ui}>roll</span>,{" "}
            <span className={styles.ui}>filter</span>, <span className={styles.ui}>env</span>,{" "}
            <span className={styles.ui}>fx</span>, <span className={styles.ui}>eq</span>,{" "}
            <span className={styles.ui}>comp</span>, <span className={styles.ui}>mod</span>,{" "}
            <span className={styles.ui}>aut</span> — opens the panels described in{" "}
            <a href="#shaping">filter, effects and dynamics</a> and{" "}
            <a href="#motion">modulation and automation</a>.
          </p>
          <p>
            Wherever you meet a control you do not recognise, in a track row or in
            any of those panels, <a href="#motion">right-click it</a>: you get what
            it does, and whatever movement is on it.
          </p>
        </section>

        <section className={styles.section} id="steps">
          <h2>The step grid</h2>
          <p>
            The row of squares is the pattern. A filled square is a note; every fourth
            square is marked so you can find the beat.
          </p>
          <ul>
            <li><strong>Click</strong> an empty square to add a note, or a filled one to remove it.</li>
            <li><strong>Drag right</strong> from a note to make it longer.</li>
            <li><strong>Drag up or down</strong> on a note to change its pitch.</li>
            <li><strong>Double-click</strong> to set a note to full velocity.</li>
            <li><strong>Right-click</strong> (or press and hold on a touchscreen) to open the step editor.</li>
          </ul>
          <p>
            For drum tracks the pitch rarely matters, so the grid is all you need. For
            melodies, the piano roll is easier.
          </p>
        </section>

        <section className={styles.section} id="roll">
          <h2>The piano roll</h2>
          <p>
            <span className={styles.ui}>roll</span> opens a pitch-by-time grid: pitches
            up the side, steps across. It is the best place to write a melody, and the
            only place to stack notes into a chord you draw by hand.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Gesture</th><th>Result</th></tr>
              </thead>
              <tbody>
                <tr><td>Click empty space</td><td>Adds a one-step note. Keep dragging right to make it longer as you create it.</td></tr>
                <tr><td>Drag a note&apos;s middle</td><td>Moves the whole note — left and right in time, up and down in pitch. Its length is kept.</td></tr>
                <tr><td>Drag a note&apos;s edge</td><td>Resizes it. The left edge moves the start, the right edge moves the end.</td></tr>
                <tr><td>Drag a one-step note</td><td>Its single cell does both: the right sliver resizes, the rest moves. The cursor tells you which you are on.</td></tr>
                <tr><td>Double-click a note</td><td>Deletes it. On a stacked note it deletes only the row you clicked.</td></tr>
                <tr><td>Click an empty row above a note</td><td>Stacks another pitch onto that step, for chords you voice yourself.</td></tr>
                <tr><td>Right-click / long press</td><td>Opens the step editor for that note.</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            The lane underneath is velocity — drag a bar to make that step harder or
            softer. The buttons along the top shift every note up a step, double or
            halve the pattern length, or roll a new melody.
          </p>
          <div className={styles.note}>
            A track plays one note at a time per step, so a note stops where the next
            one begins. To play pitches together, stack them on the same step or use a
            chord in the step editor.
          </div>
        </section>

        <section className={styles.section} id="step-editor">
          <h2>The step editor</h2>
          <p>
            Right-click any step to open everything that step can do beyond pitch and
            length.
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Setting</th><th>What it does</th></tr>
              </thead>
              <tbody>
                <tr><td>note</td><td>The pitch, on a small keyboard.</td></tr>
                <tr><td>chord</td><td>Plays a whole chord from that root — major, minor, sevenths and so on — plus an inversion.</td></tr>
                <tr><td>arp</td><td>Instead of sounding together, the chord&apos;s notes play one after another for the length of the note. Set how fast, how many octaves, and which direction.</td></tr>
                <tr><td>ratchet</td><td>Retriggers the step up to 8 times — drum rolls and stutters.</td></tr>
                <tr><td>vel</td><td>How hard the note hits.</td></tr>
                <tr><td>offset</td><td>Nudges the step slightly early or late for a looser feel.</td></tr>
              </tbody>
            </table>
          </div>
          <div className={styles.note}>
            An arp fills the note&apos;s length, so give it room. A one-step note at a
            1/16 arp rate only has space for a single note — lengthen the note, or pick
            a faster rate, to hear the pattern.
          </div>
        </section>

        <section className={styles.section} id="keyboard">
          <h2>Playing from your keyboard</h2>
          <p>
            On a desktop machine your computer keyboard always plays the active track —
            the one you clicked last, which is outlined. Typing in a text box is safe;
            note keys only play when no text field has focus.
          </p>
          <p>
            The layout is a piano: the home row is the white keys and the row above
            holds the black keys.
          </p>
          <ul>
            <li>
              <span className={styles.key}>a</span> <span className={styles.key}>s</span>{" "}
              <span className={styles.key}>d</span> <span className={styles.key}>f</span>{" "}
              <span className={styles.key}>g</span> <span className={styles.key}>h</span>{" "}
              <span className={styles.key}>j</span> <span className={styles.key}>k</span>{" "}
              <span className={styles.key}>l</span> — white keys
            </li>
            <li>
              <span className={styles.key}>w</span> <span className={styles.key}>e</span>{" "}
              <span className={styles.key}>t</span> <span className={styles.key}>y</span>{" "}
              <span className={styles.key}>u</span> <span className={styles.key}>o</span> — black keys
            </li>
            <li>
              <span className={styles.key}>z</span> <span className={styles.key}>x</span> — down and up an octave
            </li>
          </ul>
          <p>Two ways to get what you play into a pattern:</p>
          <ul>
            <li>
              <strong>Record</strong> — switch on <span className={styles.ui}>record</span>,
              start playback, and notes land on the step passing underneath.
            </li>
            <li>
              <strong>Capture</strong> — play freely with the sequencer stopped or
              running, then press <span className={styles.ui}>capture</span>. Your last
              phrase is written into the track with its timing and note lengths, and
              the pattern is sized to fit.
            </li>
          </ul>
        </section>

        <section className={styles.section} id="scale">
          <h2>Scale and chords</h2>
          <p>
            Tick <span className={styles.ui}>scale</span> and pick a root and a mode to
            lock your playing to a key. Everything you play on the white keys then
            belongs to that scale — the black keys go quiet, so there are no wrong
            notes. There are major and minor modes, pentatonics, blues, several exotic
            scales, and microtonal tunings.
          </p>
          <p>
            The palette button next to it colours notes by pitch across the roll and
            grid, which makes repeated shapes easy to spot.
          </p>
          <h3>Chord mode</h3>
          <p>
            With <span className={styles.ui}>chord</span> on, each key plays a whole
            chord instead of one note. Pick the chord type and a voicing. With a scale
            active the choice collapses to on or off, because the chord is built from
            the scale itself — so each degree gets the quality it should have, and
            everything stays in key.
          </p>
          <p>
            Chords you record or capture are stored as a chord, not as loose notes, so
            the roll shows a single labelled note you can retune or move in one go.
          </p>
          <h3>Arp</h3>
          <p>
            The <span className={styles.ui}>arp</span> box appears next to the chord
            picker. Switch it on and a held key arpeggiates as you play, at the rate,
            octave range and direction you choose. Chords you then record or capture
            carry those arp settings into the pattern.
          </p>
        </section>

        <section className={styles.section} id="engines">
          <h2>Sound engines</h2>
          <p>
            The dropdown beside a track&apos;s name chooses its instrument. They are
            grouped:
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Group</th><th>What is in it</th></tr>
              </thead>
              <tbody>
                <tr><td>plaits</td><td>Sixteen synthesis models from the Mutable Instruments Plaits oscillator — virtual analogue, FM, wavetable, granular, noise, and physical models.</td></tr>
                <tr><td>drum / synth</td><td>An 808 and 909 kit, a poly saw, an FM bell and a pad.</td></tr>
                <tr><td>Emulators</td><td>The 303 — a model of the acid machine&rsquo;s own circuits, down to the diode-ladder filter and the accent behaviour (see <a href="#tb303">below</a>). The virus, a polyphonic model of the digital synth that defined trance and drum and bass, with its two routable filters and its hypersaw (see <a href="#virus">below</a>). The dx7, six sine operators through the machine&rsquo;s own 32 algorithms (see <a href="#dx7">below</a>). An electric guitar and an electric bass, each modelled as a whole rig — string, pickup, amp, cab — with a dropdown of famous tones (see <a href="#guitar">below</a>). Plus five monosynth voices in the spirit of classic hardware: MiniBrute, Moog, Juno, Rhodes and Prophet.</td></tr>
                <tr><td>texture</td><td>A granular engine that plays a sample as a cloud of tiny grains.</td></tr>
                <tr><td>wavetable</td><td>A wavetable synth with its own <a href="#wavetable">editor</a>.</td></tr>
                <tr><td>sampler</td><td>Your own audio, or one of the bundled kits. See <a href="#sampler">samples</a>.</td></tr>
                <tr><td>saved patches</td><td>Sounds you have saved yourself.</td></tr>
                <tr><td>midi</td><td>Sends notes to external hardware or software instead of making sound itself.</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            The four sliders under the name — labelled per engine, for example{" "}
            <span className={styles.ui}>harm</span>, <span className={styles.ui}>timb</span>,{" "}
            <span className={styles.ui}>morph</span> and <span className={styles.ui}>decay</span>{" "}
            on a Plaits model — are that instrument&apos;s main tone controls. The
            labels change with the engine, so they always say what they actually do.
          </p>
        </section>

        <section className={styles.section} id="tb303">
          <h2>The 303</h2>
          <p>
            The <span className={styles.ui}>303</span> engine is modelled on the
            machine rather than approximated with a filter preset, so it responds
            to a pattern the way the original does. Its four sliders are the panel
            knobs: <span className={styles.ui}>cutoff</span>,{" "}
            <span className={styles.ui}>reso</span>,{" "}
            <span className={styles.ui}>env mod</span> and{" "}
            <span className={styles.ui}>decay</span>. Beside them sit the waveform
            switch, the accent depth and tuning.
          </p>
          <p>Three things are worth knowing, because they are how you play it:</p>
          <ul>
            <li>
              <strong>Accent comes from step velocity.</strong> Push a step past
              about two-thirds and it accents: louder, brighter, and with the
              filter decay forced short. Turn the resonance up and consecutive
              accents stack into a rising squelch instead of each being separate —
              that pile-up is the sound of an acid line.
            </li>
            <li>
              <strong>Slide comes from note length.</strong> Draw a step longer
              than one cell and the note after it slides out of it: the pitch
              glides across and the envelope is not retriggered.
            </li>
            <li>
              <strong>Plain steps are clipped short</strong>, a little over half
              the step, which is what makes the part drive rather than run
              together. Lengthen a note if you want it to hold.
            </li>
          </ul>
          <p>
            The filter loses low end as the resonance climbs, exactly as the real
            one does. That is why acid records run a 303 into a distortion pedal —
            reach for the track&apos;s <span className={styles.ui}>fx</span> panel
            and do the same.
          </p>
        </section>

        <section className={styles.section} id="virus">
          <h2>The virus</h2>
          <p>
            Where the 303 is one idea done perfectly, the virus is a big
            polyphonic synth built for movement. Its four sliders are{" "}
            <span className={styles.ui}>cutoff</span>,{" "}
            <span className={styles.ui}>reso</span>,{" "}
            <span className={styles.ui}>shape</span> and{" "}
            <span className={styles.ui}>decay</span>; the four beside them are
            the levels of osc 1, osc 2, the sub and the noise. Everything else
            is in the three rows underneath.
          </p>
          <p>Four things are worth reaching for first:</p>
          <ul>
            <li>
              <strong>Shape</strong> is one continuous morph from a sine,
              through a triangle and a saw, to a pulse — and at the very top the
              pulse width slider takes over. Sweep it and the tone changes
              character rather than just brightness.
            </li>
            <li>
              <strong>Unison</strong> is the hypersaw. Each note plays up to
              eight detuned copies of the whole oscillator section, spread
              across the stereo field. Two or three is a thickening; eight with
              the detune up is the wide trance sound.
            </li>
            <li>
              <strong>Two filters, not one.</strong> Each can be a low pass,
              high pass, band pass or notch, and you choose how they connect:
              in series (one into the other), in parallel, or split so filter 1
              plays the left ear and filter 2 the right. A low pass into a high
              pass in series is a band pass you can sweep from both ends.
            </li>
            <li>
              <strong>Saturation sits between them</strong>, which is the whole
              trick — filter 2 tidies up whatever the saturator did to filter
              1&apos;s output, so you can be filthy and controlled at once. It
              runs from a gentle warmth through hard clipping to a bit reducer
              and a rate reducer.
            </li>
          </ul>
          <p>
            Sync is the other one to know: turn it on and osc 2 is forced to osc
            1&apos;s pitch, so dragging the <span className={styles.ui}>semi</span>{" "}
            slider (or automating it) gives the classic tearing sync lead.
          </p>
        </section>

        <section className={styles.section} id="dx7">
          <h2>The dx7</h2>
          <p>
            Six sine waves. That is the entire instrument — no filter, no sub
            oscillator, nothing else. What you get out of it depends only on
            which sines are wired into which, and how hard. The panel is the
            same six rows whatever you are making: one row per operator, with
            its level, its frequency as a ratio of the note, and its own
            envelope.
          </p>
          <p>Four things to know, in the order they matter:</p>
          <ul>
            <li>
              <strong>The algorithm is the wiring.</strong> There are 32 of
              them and you cannot make your own — that was true of the machine
              too. The dropdown draws each one:{" "}
              <span className={styles.ui}>1←2</span> means operator 2 modulates
              operator 1. Beside it the panel says which operators are{" "}
              <em>carriers</em> — the ones that reach your ears, whose level is
              simply volume. Every other operator is a modulator, and its level
              is how hard it bends the one below it. The carrier rows are
              highlighted, so you can always see which is which.
            </li>
            <li>
              <strong>Level is exponential, and level is everything.</strong> A
              modulator at half its slider is a sixteenth of full scale, so
              almost all of the interesting range is in the top quarter. Nudging
              one modulator level is how you program this thing.
            </li>
            <li>
              <strong>Every operator has its own envelope</strong>, which means
              the timbre has an envelope. A modulator that decays fast under a
              carrier that does not is a struck sound — that is the whole trick
              behind an FM electric piano, and it is why the dx7 made a noise
              nothing before it could.
            </li>
            <li>
              <strong>Feedback</strong> is the only thing in the machine making
              harmonics that is not another operator. Wind the{" "}
              <span className={styles.ui}>fbk</span> slider up and it stops
              being a tone and turns into noise — which is where the breaths and
              cymbals come from. Which operator carries it depends on the
              algorithm; the panel says which.
            </li>
          </ul>
          <p>
            The four track sliders ride all six operators at once:{" "}
            <span className={styles.ui}>bright</span> is every modulator&apos;s
            level together (the fastest way to hear what a patch can do),{" "}
            <span className={styles.ui}>fbk</span> is the feedback,{" "}
            <span className={styles.ui}>mod dec</span> scales how fast the
            timbre falls away and <span className={styles.ui}>decay</span> how
            fast the note does.
          </p>
          <p>
            Start from the <span className={styles.ui}>voice</span> dropdown
            rather than from silence — an electric piano, a bass, a bell, brass,
            a marimba, an organ and a pad. Load one and change a single operator
            level, and you are programming a dx7. Two others are worth knowing:{" "}
            <span className={styles.ui}>vel</span> makes playing harder raise
            the modulation index, so hard notes are brighter and not just
            louder, and <span className={styles.ui}>key scale</span> pulls the
            modulators back as you play up the keyboard — without it the top
            octave screams.
          </p>
        </section>

        <section className={styles.section} id="guitar">
          <h2>The guitar and the bass</h2>
          <p>
            Neither of these is a plucked-string preset. Each one models the
            whole chain a real one goes through — the string, the pickup that
            reads it, the amp it runs into and the speaker in front of the mic —
            because on these instruments the sound is the chain and not the note.
          </p>
          <p>
            Both start from a <span className={styles.ui}>tone</span> dropdown of
            famous rigs. That is the honest way in: load the nearest one, then
            move a control and hear what that control is actually for. Loading a
            tone replaces everything, including the four track sliders, so
            nothing of the last one is left behind.
          </p>
          <h3>The guitar</h3>
          <p>
            The string is a waveguide with the losses of a real one: the highs
            die before the fundamental does, which is why a guitar note gets
            duller as it rings rather than merely quieter. Where you pick it
            notches harmonics out of it — bridge is thin and cutting, over the
            neck is round — and the pickup does the same again on the way out.
            Which pickup you choose is really a choice of where its resonance
            sits: a single coil peaks high and glassy, a humbucker low and fat.
          </p>
          <p>
            The four track sliders are <span className={styles.ui}>drive</span>{" "}
            (how hard the amp is hit, on a log taper like the real pot),{" "}
            <span className={styles.ui}>tone</span> (the knob on the guitar
            itself, not the amp — roll it right down with a neck humbucker for
            the darkest sound the instrument has),{" "}
            <span className={styles.ui}>bloom</span> and{" "}
            <span className={styles.ui}>sustain</span>.
          </p>
          <p>
            <span className={styles.ui}>bloom</span> is feedback, and it is worth
            knowing what it does. The speaker is coupled back into the strings,
            so past a certain point the energy coming back beats the string&apos;s
            own losses and the note stops decaying and starts growing. It needs
            volume — a clean amp barely blooms, a cranked one sings — and it stops
            when the note ends, exactly as taking your hand off the string does.
            Hold a long step on a high setting and listen to it climb.
          </p>
          <h3>The bass</h3>
          <p>
            Same string, wound and stiffer: its harmonics sit noticeably sharp of
            where the arithmetic says, and that disagreement between the pitch and
            the clank is most of what a bass sounds like. Flatwounds take it away
            along with the high end, which is why every record made before about
            1970 sounds the way it does — that is the{" "}
            <span className={styles.ui}>roundwound / flatwound</span> select.
          </p>
          <p>
            Two things on the panel are worth finding.{" "}
            <span className={styles.ui}>fret</span> is how hard the string is
            allowed to clatter against the fretboard; wound up with the hand
            control at the top, that clatter is what slap is.{" "}
            <span className={styles.ui}>grind</span> is distortion, but only above
            the <span className={styles.ui}>xover</span> frequency, with the clean
            low end put back underneath — distort a bass whole and the bottom
            disappears, which is why every bass overdrive worth having works this
            way.
          </p>
          <p>
            The sliders are <span className={styles.ui}>drive</span>,{" "}
            <span className={styles.ui}>tone</span>,{" "}
            <span className={styles.ui}>comp</span> and{" "}
            <span className={styles.ui}>sustain</span>. Compression gets a slider
            of its own because a bass part sitting perfectly still under
            everything else is a compressor doing that, and it is as much the
            sound as the amp is.
          </p>
        </section>

        <section className={styles.section} id="sampler">
          <h2>Samples</h2>
          <p>
            Choose <span className={styles.ui}>sampler</span> as a track&apos;s engine
            and you are asked for a source: a file from your machine, or one of the
            bundled drum kits. The waveform button in the track header then opens the
            sample editor.
          </p>
          <ul>
            <li>Trim the start and end, and fade either edge.</li>
            <li>Slice a loop and play the slices from the grid, one per note.</li>
            <li>Fit a loop to the tempo, or leave it at its natural speed.</li>
            <li>Keep pitch locked so a tempo-fitted loop stays in tune, or unlock it to play the sample melodically.</li>
          </ul>
          <p>
            Files you load stay in your browser. They are only sent anywhere if you
            save the session to an account or make a share link.
          </p>
        </section>

        <section className={styles.section} id="wavetable">
          <h2>The wavetable editor</h2>
          <p>
            With the wavetable engine selected, the waveform button opens an editor
            where you draw the sound itself. A wavetable is a series of frames — single
            cycles of a waveform — and the wave slider sweeps between them.
          </p>
          <ul>
            <li><strong>Draw</strong> straight onto the canvas, or build the shape with the harmonic sliders underneath.</li>
            <li><strong>Load</strong> a starting point: basic shapes, or any of the bundled waveforms.</li>
            <li><strong>Add frames</strong> and the wave slider morphs smoothly between them.</li>
            <li><strong>Unison</strong> stacks up to 7 copies of the voice per note, spread apart by the track&apos;s detune slider, for a wide supersaw-style sound.</li>
            <li><strong>Wave scan</strong> sweeps through the frames on its own — set the speed (free or in time with the tempo), the direction, and which part of the table it covers. Retrigger restarts the sweep on every note instead of letting it run continuously.</li>
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
                <tr><td>filter</td><td>A low-pass filter with cutoff and resonance — the classic way to open and close a sound.</td></tr>
                <tr><td>env</td><td>An envelope that sweeps the filter on every note: how far it moves, and how it attacks, decays, sustains and releases.</td></tr>
                <tr><td>fx</td><td>The effects chain, below.</td></tr>
                <tr><td>eq</td><td>Three bands — low, middle and high — to sit a track in the mix.</td></tr>
                <tr><td>comp</td><td>Compression, either on the track itself or ducked by another track, which is how you get a pumping bass under a kick.</td></tr>
              </tbody>
            </table>
          </div>
          <h3>The effects chain</h3>
          <p>
            Effects run in the order they appear in the panel, starting with{" "}
            <span className={styles.ui}>amp</span>: <span className={styles.ui}>drive</span>{" "}
            pushes the signal into everything that follows, so fuzz, the wave shaper,
            tape saturation and the crusher all bite harder, and{" "}
            <span className={styles.ui}>out</span> trims the level back afterwards. Both
            sit at unity in the middle.
          </p>
          <p>
            After that come vinyl and cassette (wear, warble and noise), fuzz, ring
            modulation, a wave shaper, a bit crusher, auto-wah, chorus, phaser,
            flanger, pitch shift, delay and reverb. Each has a wet or amount control
            that does nothing at zero, so the panel is safe to explore.
          </p>
          <p>
            <span className={styles.ui}>glide</span> lives here too: it slides the pitch
            between notes rather than jumping, for portamento leads and basses.
          </p>
        </section>

        <section className={styles.section} id="bus">
          <h2>Fx buses</h2>
          <p>
            Everything in the panels above belongs to one track. So does the mod
            matrix, and so do the automation lanes. An <span className={styles.ui}>fx bus</span>{" "}
            is how several tracks come to share them: it is a track with no
            instrument in it, and other tracks are routed through it instead of
            going straight to the master.
          </p>
          <p>
            Press <span className={styles.ui}>+ add fx bus</span> under the tracks (or
            pick <span className={styles.ui}>fx bus</span> from any track&apos;s engine
            dropdown). An <span className={styles.ui}>out</span> control then appears on
            every track: set it to the bus and that track arrives there with its own
            sound intact, exactly as an output assignment works on a mixer.
          </p>
          <p>
            The bus itself is an ordinary track in every other respect. Its filter,
            its effects, its eq and its compressor act on everything feeding it at
            once; its <span className={styles.ui}>mod</span> panel sweeps that whole
            group with one LFO; its <span className={styles.ui}>aut</span> lanes draw
            per-step movement across all of it; and it can be{" "}
            <a href="#lock">p-locked</a>, so the group is drenched in one pattern and
            dry in the next. A bus can also be sent into another bus. Sends that
            would loop back on themselves are refused.
          </p>
          <p>
            A bus plays no notes, so its step grid and roll are gone.{" "}
            <span className={styles.ui}>mute</span> on a bus cuts the audio passing
            through it — everywhere else mute only withholds a track&apos;s notes, and
            a bus has none. <span className={styles.ui}>solo</span> on a bus keeps
            whatever feeds it, which is what you meant by soloing it.
          </p>
        </section>

        <section className={styles.section} id="lock">
          <h2>p-lock</h2>
          <p>
            A track normally has one sound and 32 patterns of notes. Move its
            filter and it moves everywhere, because the sound belongs to the
            track and only the notes belong to the pattern.
          </p>
          <p>
            The <span className={styles.ui}>p-lock</span> button in a track&apos;s
            button row changes that for the pattern you are on. Locked, that
            pattern keeps its own sound; every pattern you leave unlocked goes on
            sharing the track&apos;s. So you can give the bass a bright, delayed
            sound for the chorus and leave the verse and the middle eight alone —
            and they still move together when you tweak them.
          </p>
          <p>
            It is per pattern, so the button changes as you move around: it lights
            up on the patterns you have locked. In chain mode the sound changes
            come with the arrangement, on the bar.
          </p>
          <p>Everything about the sound comes along:</p>
          <ul>
            <li>the engine&apos;s own controls — the four sliders and whatever panel it has</li>
            <li>the filter and its envelope</li>
            <li>the effects rack, the eq and the compressor</li>
            <li>the modulation assignments in the mod panel</li>
          </ul>
          <p>
            What does <em>not</em> move is the instrument itself: the engine, and
            any sample loaded into it, stay put. A locked pattern is one instrument
            being played differently, not a different instrument.
          </p>
          <div className={styles.note}>
            Editing while on an unlocked pattern edits the shared track sound, so
            every other unlocked pattern follows. Editing on a locked one changes
            only that pattern. Unlocking hands a pattern back to the shared sound
            but keeps what it had, so locking it again brings it straight back.
          </div>
        </section>

        <section className={styles.section} id="motion">
          <h2>Modulation and automation</h2>
          <p>
            Two ways to make a sound move. Both are per track, and both are worth using
            on almost anything that repeats for long.
          </p>
          <h3>mod — continuous</h3>
          <p>
            Assign an LFO to a parameter and it sweeps back and forth on its own. Pick
            the target, a shape, a depth, and either a speed in hertz or a division of
            the tempo so it stays in time. Filter cutoff is the classic target;
            effect amounts and the instrument&apos;s own tone controls work too.
          </p>
          <h3>aut — per step</h3>
          <p>
            Automation draws a value for each step of the pattern instead. Choose a
            parameter, and you get a lane under the grid where each step holds its own
            value — a filter that opens over 16 steps, a delay that only appears on the
            last beat. Automation lanes belong to the pattern, so each pattern can move
            differently.
          </p>
          <h3>Right-click any parameter</h3>
          <p>
            The two panels above list a whole track at once, which is the long way
            round when the question is what is moving <em>this</em> control.
            Right-click a slider, a switch or its label — anywhere: the instrument
            row, the filter, effects, eq and comp panels, the sample and wavetable
            editors — and you get a small window for that one parameter: what it
            does, whatever LFO or automation is on it, and a button to add either.
            It is also the quickest way to learn an unfamiliar control, since the
            explanation is the first thing in the window.
          </p>
          <p>
            You do not have to go looking, either: a parameter with something on
            it wears a dot next to its label — green for an LFO, blue for an
            automation lane, grey for a lane you have switched off. Scan a track
            and you can see where its movement is coming from.
          </p>
          <div className={styles.note}>
            A parameter takes an LFO or an automation lane, not both — two things
            writing the same value fight, and you hear one of them drop out at
            random. Whichever side is free offers to be added; the other says what
            is holding the parameter, and removing that frees it up again. Controls
            that are a setting rather than a value — a waveform, a filter mode, a
            routing switch — open the same window with the explanation and no
            movement to add.
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
                <tr><td>session</td><td>Saves the whole session — every track, pattern and setting — into this browser.</td></tr>
                <tr><td>save (signed in)</td><td>Stores the session to your account so you can open it anywhere, and keep a library of songs.</td></tr>
                <tr><td>share</td><td>Creates a link anyone can open. They get a playable copy; your original is untouched.</td></tr>
                <tr><td>patch</td><td>The save icon in a track header stores that instrument&apos;s sound, which then appears under saved patches for any track. Signed in, you can publish patches to the gallery for others to use.</td></tr>
                <tr><td>Pattern / Session</td><td>Renders audio and downloads a WAV — either the current pattern, or the whole chained arrangement. Recording happens in real time, so a long session takes as long as it plays.</td></tr>
              </tbody>
            </table>
          </div>
          <p>
            Without an account everything stays in your browser, which means clearing
            site data clears your work. An account is the way to keep it.
          </p>
        </section>

        <section className={styles.section} id="trouble">
          <h2>If something sounds wrong</h2>
          <ul>
            <li>
              <strong>No sound at all.</strong> Press <span className={styles.ui}>play</span>{" "}
              once more — browsers hold audio back until you interact with the page.
              Then check that no other track is soloed, and that the track&apos;s volume
              is up.
            </li>
            <li>
              <strong>A track is silent.</strong> Look for a soloed track elsewhere, a
              muted one here, or a filter cutoff closed all the way down.
            </li>
            <li>
              <strong>Playback stutters.</strong> Reverb, granular and pitch shift are
              the expensive effects; a lot of them at once on a slow machine will do
              it. Closing other tabs helps more than you would expect.
            </li>
            <li>
              <strong>The playhead looks out of time with what you hear.</strong> Safari
              cannot report its audio delay, so the display is an estimate. Add{" "}
              <span className={styles.ui}>?vlat=0.2</span> to the address to tune it to
              your machine.
            </li>
            <li>
              <strong>An arp is not audible.</strong> The note is probably too short to
              fit more than one arp note. Lengthen it or choose a faster arp rate.
            </li>
            <li>
              <strong>Sound cut out after switching apps.</strong> Click anywhere on the
              page; the audio engine reconnects on your next interaction.
            </li>
          </ul>
        </section>

        <section className={styles.section} id="credits">
          <h2>Credits and licences</h2>
          <p>
            seqbaby is built on other people&apos;s work. Thank you to everyone
            below — and if you use the sounds in something you release, the
            licences here are the ones that travel with them.
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
                  <td><a href="https://github.com/KristofferKarlAxelEkstrand/AKWF-FREE" target="_blank" rel="noopener">AKWF — Adventure Kid Waveforms</a> by Kristoffer Ekstrand</td>
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
