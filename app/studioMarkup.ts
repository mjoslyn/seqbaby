// AUTO-PORTED from the original public/index.html <body> (scripts stripped).
// This is the exact static DOM skeleton the vanilla engine (public/js/main.js)
// queries by id/class at boot. Rendered server-side via dangerouslySetInnerHTML;
// the three engine <script>s are injected client-side by ScriptLoader in order.
// The DX7's operator matrix: six operators by eight controls. Written as a loop
// rather than 54 hand-copied inputs — the columns only differ by operator
// number, and a typo in one of them would be invisible until that operator
// stopped responding. The algorithm and preset dropdowns are filled at runtime
// (populateDx7Selects in render.js) so their lists live only in dx7.js.
// Ranges and defaults must match DX7_DEFAULTS there.
const DX7_OP_COLS: Array<{ k: string; min: string; max: string; step: string; head: string; title: string }> = [
  { k: "lvl", min: "0", max: "1", step: "0.01", head: "level",
    title: "the operator's output level, and the single most important control on the machine. It is exponential: a modulator at half is a sixteenth of full scale, so the top of the slider is where the spectrum opens up. For a carrier it is volume in the mix; for a modulator it is how much it bends the operator below it" },
  { k: "rat", min: "0", max: "31", step: "1", head: "ratio",
    title: "frequency as a multiple of the note, 1 to 31 (the bottom step is the machine's half-ratio, an octave down). Whole numbers give harmonic, pitched tones; the interesting ones for bells and mallets are the ratios that do not divide" },
  { k: "fin", min: "0", max: "0.99", step: "0.01", head: "fine",
    title: "fine ratio, up to one whole ratio above the coarse setting. This is where inharmonicity comes from — a modulator at 3.5 rather than 3 is the difference between an organ and a bell" },
  { k: "det", min: "-7", max: "7", step: "1", head: "det",
    title: "detune, seven steps of about 1.75 cents either way — the machine's own unit. Two operators at the same ratio, detuned apart, beat against each other" },
  { k: "atk", min: "0", max: "1", step: "0.01", head: "atk",
    title: "how long this operator takes to reach full level. On a modulator it is how long the tone takes to open up, which is what separates a brass swell from a struck bell" },
  { k: "dec", min: "0", max: "1", step: "0.01", head: "dec",
    title: "how fast it falls from full level to its sustain. A modulator that decays under a carrier that does not is the entire trick behind the DX7's electric pianos" },
  { k: "sus", min: "0", max: "1", step: "0.01", head: "sus",
    title: "the level this operator holds at for as long as the note lasts. At zero the operator is gone once the decay finishes — percussive; up high it holds — sustained" },
  { k: "rel", min: "0", max: "1", step: "0.01", head: "rel",
    title: "how long this operator takes to fade once the note ends" },
];
const DX7_OP_DEFAULTS: Record<string, (op: number) => string> = {
  lvl: (i) => (i === 1 ? "1" : i === 2 ? "0.72" : "0"),
  rat: () => "1", fin: () => "0", det: () => "0",
  atk: () => "0.01", dec: () => "0.45",
  sus: (i) => (i === 1 ? "0.8" : "0.4"), rel: () => "0.3",
};
const dx7OpRows = () => [1, 2, 3, 4, 5, 6].map(i => `
          <div class="sq-dx7__oprow" data-op="${i}">
            <span class="sq-dx7__opn">op ${i}</span>
${DX7_OP_COLS.map(c => `            <label class="sq-dx7__f"><input class="p-d${i}${c.k}" type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${DX7_OP_DEFAULTS[c.k](i)}" title="${c.title}" /></label>`).join("\n")}
            <select class="p-d${i}fix" title="ratio mode tunes this operator to the note; fixed mode pins it to a frequency between 1Hz and 10kHz (set by ratio and fine) whatever note you play, ignoring the pitch envelope and the lfo with it. Fixed operators are where the DX7's knocks, breaths and cymbals come from">
              <option value="ratio" selected>ratio</option><option value="fixed">fixed</option>
            </select>
          </div>`).join("");

const DX7_PANEL = `
        <div class="sq-param-group sq-param-group--dx7" hidden>
          <div class="sq-dx7__row">
            <span class="sq-dx7__lbl">alg</span>
            <select class="p-dalg" title="which of the machine's 32 fixed wirings the six operators run in. The arrows say what modulates what: 1←2 means operator 2 modulates operator 1, and everything with no arrow into it is a carrier you actually hear"></select>
            <span class="sq-dx7__alg"></span>
            <span class="sq-dx7__lbl">voice</span>
            <select class="sq-dx7__preset" title="load a complete voice — all six operators, the algorithm, and the four sliders. In the spirit of the machine's own presets rather than its rom, and the honest way to start: change one operator level at a time from here and you are programming a DX7"></select>
          </div>
          <div class="sq-dx7__row">
            <label class="sq-dx7__f"><span>key scale</span><input class="p-dks" type="range" min="0" max="1" step="0.01" value="0.35" title="how much the modulators are pulled back as you play up the keyboard. Without it the top octave screams, because a fixed modulation index is far brighter at 2kHz than at 100Hz — every acoustic instrument gets duller as it goes up, and this is how the DX7 gets away with it" /></label>
            <label class="sq-dx7__f"><span>vel</span><input class="p-dvs" type="range" min="0" max="1" step="0.01" value="0.5" title="how much playing harder raises the modulation index. This is the DX7's defining gesture: velocity changes the timbre, not just the volume, so a hard note is brighter and not merely louder" /></label>
            <label class="sq-dx7__f"><span>pitch env</span><input class="p-dpeg" type="range" min="-1" max="1" step="0.01" value="0" title="a pitch sweep at the start of every note, up to two octaves either way. Small amounts are the wooden knock at the front of a mallet sound; large ones are the sound of 1985" /></label>
            <label class="sq-dx7__f"><span>rate</span><input class="p-dpegr" type="range" min="0" max="1" step="0.01" value="0.3" title="how fast that pitch sweep settles back to the note" /></label>
          </div>
          <div class="sq-dx7__row">
            <span class="sq-dx7__lbl">lfo</span>
            <select class="p-dlfow" title="lfo waveform — one lfo for the whole instrument, as on the machine">
              <option value="tri" selected>tri</option><option value="sine">sine</option>
              <option value="sawdn">saw dn</option><option value="sawup">saw up</option>
              <option value="square">square</option><option value="sh">s+h</option>
            </select>
            <label class="sq-dx7__f"><span>speed</span><input class="p-dlfor" type="range" min="0" max="1" step="0.01" value="0.35" title="lfo speed, from a slow drift to 24Hz — fast enough to be an audio-rate wobble rather than a vibrato" /></label>
            <label class="sq-dx7__f"><span>delay</span><input class="p-dlfod" type="range" min="0" max="1" step="0.01" value="0" title="how long the lfo takes to fade in after a note starts. Delayed vibrato is what makes a held note sound played rather than held" /></label>
            <label class="sq-dx7__f"><span>pitch</span><input class="p-dpmd" type="range" min="0" max="1" step="0.01" value="0" title="how far the lfo moves the pitch — vibrato, up to a semitone" /></label>
            <label class="sq-dx7__f"><span>amp</span><input class="p-damd" type="range" min="0" max="1" step="0.01" value="0" title="how far the lfo moves the level — tremolo" /></label>
            <select class="p-dlfok" title="key sync restarts the lfo on every note, so the vibrato arrives at the same point each time. Off leaves one free-running lfo that every note joins wherever it happens to be">
              <option value="on" selected>key sync</option><option value="off">free run</option>
            </select>
          </div>
          <div class="sq-dx7__ops">
            <div class="sq-dx7__ophead">
              <span></span>
${DX7_OP_COLS.map(c => `              <span>${c.head}</span>`).join("\n")}
              <span></span>
            </div>${dx7OpRows()}
          </div>
        </div>`;

// The electric guitar's rig: where the string is picked, which pickup reads it,
// and the amp and cab it runs into. The tone dropdown ships EMPTY and is filled
// at runtime by renderTrack from GUITAR_TONE_NAMES, so the tones live only in
// public/js/guitar.js. Ranges and defaults here must match GUITAR_NUM_CTLS
// there — that file is the source of truth for both.
const GUITAR_PANEL = `
        <div class="sq-param-group sq-param-group--guitar" hidden>
          <div class="sq-guitar__row">
            <span class="sq-guitar__lbl">tone</span>
            <select class="sq-guitar__tone" title="load a famous rig: the pickup, where the string is picked, the amp and how hard it is driven, the cab, and the four track sliders with it. Every one of them is reachable by hand from here — start on the nearest one and move one control"></select>
            <span class="sq-guitar__desc"></span>
          </div>
          <div class="sq-guitar__row">
            <span class="sq-guitar__lbl">string</span>
            <label class="sq-guitar__f"><span>pick pos</span><input class="p-gtpick" type="range" min="0.02" max="0.5" step="0.01" value="0.28" title="where along the string you pick, from hard by the bridge to over the twelfth fret. The string cannot carry a harmonic that has a node where it was struck, so this notches those harmonics out — which is the whole reason picking by the bridge is thin and cutting and picking over the neck is round" /></label>
            <label class="sq-guitar__f"><span>pick</span><input class="p-gtpnoise" type="range" min="0" max="1" step="0.01" value="0.5" title="how hard the thing striking the string is: a thumb at the bottom, a plectrum at the top. It sets how much high-frequency energy the pluck puts into the string in the first place" /></label>
            <label class="sq-guitar__f"><span>stiff</span><input class="p-gtstiff" type="range" min="0" max="1" step="0.01" value="0.25" title="string stiffness. A real string's harmonics sit slightly sharp of where the arithmetic says, and the thicker and more wound it is the further out they go. A little is a wound low string; a lot goes piano-like and metallic" /></label>
            <label class="sq-guitar__f"><span>pkup pos</span><input class="p-gtpkup" type="range" min="0.02" max="0.5" step="0.01" value="0.12" title="where along the string the pickup sits: bridge at the bottom, neck at the top. Same comb as the pick position, applied on the way out instead of on the way in" /></label>
            <select class="p-gtpkupt" title="which pickup. What you hear when you flick the selector is not the number of coils but where the pickup's own resonance sits — a single coil peaks around 6kHz and a humbucker around 3, and everything else follows from that">
              <option value="single">single coil</option><option value="hum" selected>humbucker</option><option value="p90">p90</option>
            </select>
            <label class="sq-guitar__f"><span>palm</span><input class="p-gtmute" type="range" min="0" max="1" step="0.01" value="0" title="the heel of the picking hand resting on the strings at the bridge: shorter, darker and tighter all at once. It is what makes a high-gain riff a riff rather than a wall" /></label>
          </div>
          <div class="sq-guitar__row">
            <span class="sq-guitar__lbl">amp</span>
            <select class="p-gtamp" title="which amp. They differ in how much gain they have, where the tone stack works, how asymmetrically the first stage clips, and whether the distortion comes from the preamp or the power amp">
              <option value="clean">clean</option><option value="tweed">tweed</option>
              <option value="brit" selected>brit</option><option value="hi">hi-gain</option>
              <option value="jazz">jazz</option>
            </select>
            <label class="sq-guitar__f"><span>bass</span><input class="p-gtbass" type="range" min="0" max="1" step="0.01" value="0.5" title="the amp's bass control. It sits after the first gain stage, as it does in the chassis — so it shapes what is already distorted, not what goes in" /></label>
            <label class="sq-guitar__f"><span>mid</span><input class="p-gtmid" type="range" min="0" max="1" step="0.01" value="0.5" title="the amp's mid control, at whichever frequency this amp puts it. Taking it out is the eighties metal rhythm sound; leaving it in is why a seventies riff cuts through a band" /></label>
            <label class="sq-guitar__f"><span>treble</span><input class="p-gttreb" type="range" min="0" max="1" step="0.01" value="0.5" title="the amp's treble control" /></label>
            <label class="sq-guitar__f"><span>presence</span><input class="p-gtpres" type="range" min="0" max="1" step="0.01" value="0.4" title="presence, which is a treble control in the power amp's feedback loop rather than in the tone stack — it works on the distortion instead of on the signal, so it bites where treble only brightens" /></label>
            <label class="sq-guitar__f"><span>master</span><input class="p-gtmast" type="range" min="0" max="1" step="0.01" value="0.5" title="how hard the power amp is driven. On a small amp this is where most of the distortion actually comes from, and it is a different, softer thing than preamp gain" /></label>
            <label class="sq-guitar__f"><span>sag</span><input class="p-gtsag" type="range" min="0" max="1" step="0.01" value="0.3" title="how far the power supply droops under load. The note ducks as it is struck and swells back as it decays — the give of a small valve amp, and the thing solid-state ones never had" /></label>
          </div>
          <div class="sq-guitar__row">
            <span class="sq-guitar__lbl">cab</span>
            <select class="p-gtcab" title="the speaker, which is the biggest filter in the whole chain: nothing below about 90Hz and nothing above 5kHz survives it, and that is the only reason a distorted guitar is listenable">
              <option value="4x12" selected>4x12</option><option value="2x12">2x12</option>
              <option value="1x12">1x12</option><option value="1x8">1x8</option><option value="di">di (no cab)</option>
            </select>
            <label class="sq-guitar__f"><span>mic</span><input class="p-gtmic" type="range" min="0" max="1" step="0.01" value="0.35" title="where the mic sits in front of the speaker: off-axis at the bottom, straight down the middle of the cone at the top. In a room this is a whole afternoon's work, and it is mostly a lowpass" /></label>
            <label class="sq-guitar__f"><span>trem</span><input class="p-gttrem" type="range" min="0" max="1" step="0.01" value="0" title="amp tremolo — the level wobble built into the back of an old combo, after the power tubes. The one every surf record is made of" /></label>
            <label class="sq-guitar__f"><span>rate</span><input class="p-gttremr" type="range" min="0" max="1" step="0.01" value="0.4" title="tremolo speed, 1.5Hz to about 13" /></label>
            <select class="p-gttremw" title="tremolo shape: a sine wobbles, a square chops">
              <option value="sine" selected>sine</option><option value="square">square</option>
            </select>
            <label class="sq-guitar__f"><span>spring</span><input class="p-gtsprg" type="range" min="0" max="1" step="0.01" value="0" title="the reverb tank bolted into the amp — a real one is springs with transducers at each end, which is why it is dispersive and clangy rather than smooth like the rack's reverb. Turn it up and drip" /></label>
          </div>
        </div>`;

// The electric bass's rig. Same arrangement as the guitar panel above — the
// tone dropdown ships empty and is filled at runtime from BASS_TONE_NAMES, and
// the ranges and defaults must match BASS_NUM_CTLS in public/js/bass.js.
const BASS_PANEL = `
        <div class="sq-param-group sq-param-group--bass" hidden>
          <div class="sq-bass__row">
            <span class="sq-bass__lbl">tone</span>
            <select class="sq-bass__tone" title="load a famous rig: the bass, what it is strung with, how it is played, the amp and how compressed. Every control is reachable by hand from here"></select>
            <span class="sq-bass__desc"></span>
          </div>
          <div class="sq-bass__row">
            <span class="sq-bass__lbl">hand</span>
            <label class="sq-bass__f"><span>pluck pos</span><input class="p-bspick" type="range" min="0.02" max="0.5" step="0.01" value="0.14" title="where along the string it is plucked, from hard by the bridge to over the neck. It notches out the harmonics that have a node there, which is why playing by the bridge is nasal and playing over the neck is round" /></label>
            <label class="sq-bass__f"><span>hand</span><input class="p-bsattack" type="range" min="0" max="1" step="0.01" value="0.4" title="what is hitting the string: a thumb at the bottom, fingers in the middle, a plectrum at the top. Three different instruments before the amp hears anything" /></label>
            <label class="sq-bass__f"><span>fret</span><input class="p-bsfret" type="range" min="0" max="1" step="0.01" value="0.25" title="how hard the string is allowed to clatter against the frets. It is a one-sided limit inside the string's own loop, because the fretboard is only on one side of it — and wound right up, with a thumb, it is what slap actually is" /></label>
            <label class="sq-bass__f"><span>stiff</span><input class="p-bsstiff" type="range" min="0" max="1" step="0.01" value="0.45" title="string stiffness. A wound bass string's harmonics sit noticeably sharp of where the arithmetic says, far more than a guitar's — that disagreement between the pitch and the clank is most of what a bass sounds like" /></label>
            <label class="sq-bass__f"><span>pkup pos</span><input class="p-bspkup" type="range" min="0.02" max="0.5" step="0.01" value="0.1" title="which pickup, as a position along the string: bridge at the bottom, neck at the top" /></label>
            <select class="p-bspkupt" title="which pickup. The resonance is what you are choosing: a jazz single coil peaks high and growls, a precision's split humbucker sits low and thick, and a musicman is the hi-fi one">
              <option value="j">jazz</option><option value="p" selected>precision</option><option value="mm">musicman</option>
            </select>
            <select class="p-bsstrs" title="roundwound or flatwound. Flats lose their high end almost as soon as they are struck and have far less clank, which is why every record made before about 1970 sounds like that">
              <option value="round" selected>roundwound</option><option value="flat">flatwound</option>
            </select>
            <label class="sq-bass__f"><span>palm</span><input class="p-bsmute" type="range" min="0" max="1" step="0.01" value="0" title="the palm resting on the strings by the bridge — shorter and darker. With flatwounds this is the foam mute under a sixties bridge cover" /></label>
          </div>
          <div class="sq-bass__row">
            <span class="sq-bass__lbl">dirt</span>
            <label class="sq-bass__f"><span>grind</span><input class="p-bsgrind" type="range" min="0" max="1" step="0.01" value="0" title="how much distortion is mixed in. It only ever works on what is above the crossover, and the clean low end goes back underneath it — distort a bass whole and the fundamental intermodulates with everything above it and the bottom disappears" /></label>
            <label class="sq-bass__f"><span>xover</span><input class="p-bsxover" type="range" min="0" max="1" step="0.01" value="0.4" title="the frequency the dirt starts at, 120Hz to about 1.4kHz. Low is a fully dirty bass; high leaves a clean instrument with a snarl on top of it" /></label>
            <label class="sq-bass__f"><span>sub</span><input class="p-bssub" type="range" min="0" max="1" step="0.01" value="0" title="an octave below the note, tracked and following the string's own level. Half bass, half synth, and it sits where nothing else in a mix does" /></label>
          </div>
          <div class="sq-bass__row">
            <span class="sq-bass__lbl">amp</span>
            <select class="p-bsamp" title="which amp: a clean preamp with no colour, the small valve flip-top under every sixties record, the big valve stack, or the solid-state one that grinds rather than saturates">
              <option value="di">di</option><option value="flip">flip-top</option>
              <option value="svt" selected>svt</option><option value="gk">gk</option>
            </select>
            <label class="sq-bass__f"><span>bass</span><input class="p-bsbass" type="range" min="0" max="1" step="0.01" value="0.5" title="the amp's bass control" /></label>
            <label class="sq-bass__f"><span>lo mid</span><input class="p-bslomid" type="range" min="0" max="1" step="0.01" value="0.5" title="low mids, around 250Hz. This is where a bass either has weight or has mud, and it is the first thing anyone reaches for" /></label>
            <label class="sq-bass__f"><span>hi mid</span><input class="p-bshimid" type="range" min="0" max="1" step="0.01" value="0.5" title="high mids, around 800Hz — where the note becomes audible on a small speaker. Take it out for the scooped slap sound, put it in to be heard in a band" /></label>
            <label class="sq-bass__f"><span>treble</span><input class="p-bstreb" type="range" min="0" max="1" step="0.01" value="0.5" title="the amp's treble, which on a bass is mostly the sound of the strings rather than the notes" /></label>
            <label class="sq-bass__f"><span>low cut</span><input class="p-bshpf" type="range" min="0" max="1" step="0.01" value="0.15" title="high-pass filter, 28Hz to 150Hz. Below about 30Hz there is nothing but cone excursion, and this is the control every live engineer reaches for first" /></label>
            <span class="sq-bass__lbl">cab</span>
            <select class="p-bscab" title="the speaker cabinet. An eight-by-ten pushes air and rolls off early; a fifteen is all low end and no top; a DI is no cab at all">
              <option value="8x10" selected>8x10</option><option value="4x10">4x10</option>
              <option value="1x15">1x15</option><option value="2x12">2x12</option><option value="di">di (no cab)</option>
            </select>
            <label class="sq-bass__f"><span>mic</span><input class="p-bsmic" type="range" min="0" max="1" step="0.01" value="0.4" title="where the mic sits in front of the cab: off-axis and dark at the bottom, straight at the cone at the top" /></label>
          </div>
        </div>`;

export const STUDIO_BODY = String.raw`
<header class="sq-transport">
    <div class="sq-transport__main">
    <div class="sq-logo" title="seqbaby">
      <img src="/favicon.svg" alt="" />
      <span>seqbaby</span>
    </div>
    <button id="play" class="sq-play">play</button>
    <button id="kbd-record" class="sq-btn--ghost sq-icon-btn" type="button" aria-pressed="false" aria-label="record keyboard notes" title="record computer-keyboard notes into the active track while the transport plays"></button>
    <button id="kbd-capture" class="sq-btn--ghost sq-icon-btn" type="button" aria-label="capture keyboard notes" title="capture the notes you just played on the keyboard into the active track (retroactive)"></button>
    <div class="sq-field"><label for="bpm">bpm</label><input id="bpm" type="number" value="110" min="40" max="240" /></div>
    <div class="sq-field"><label for="swing">swing</label><input id="swing" type="range" min="0" max="0.5" step="0.01" value="0" /></div>
    </div><!-- /sq-transport__main -->
    <div class="sq-transport__right">
      <button id="metronome" class="sq-btn--ghost sq-icon-btn" aria-pressed="false" aria-label="metronome" title="metronome click on the downbeat"></button>
      <svg id="beat-indicator" class="sq-beat-indicator" viewBox="-22 -22 44 44" width="40" height="40" aria-hidden="true"></svg>
      <div class="sq-meter sq-meter--master" title="master output level"><div class="sq-meter__bar"></div></div>
    </div><!-- /sq-transport__right -->
    <!-- Keyboard-performance cluster: its own full-width line under the transport
         controls (see .sq-transport__kbd-row). -->
    <div class="sq-transport__kbd-row">
    <span id="kbd-icon" class="sq-kbd-icon" title="computer keyboard plays the active track — a s d f g h j k l are the white keys, w e t y u o the black ones, z / x shift octave. With a scale on, the white keys play its degrees and the black keys go silent."></span>
    <div class="sq-scale__field">
      <label class="sq-scale__toggle" title="lock to a scale — the computer keyboard's white keys (a s d f g h j k l) play the scale's degrees and the black keys go silent"><input id="scale-on" type="checkbox" /> scale</label>
      <select id="scale-root"></select>
      <select id="scale-mode"></select>
      <button id="note-colors" class="sq-btn--ghost sq-icon-btn" aria-pressed="false" aria-label="note colors" title="toggle diatonic note coloring on the piano roll + step grid"></button>
    </div>
    <span id="kbd-octave" class="sq-kbd-oct" title="keyboard base octave — press z / x to shift down / up">C4</span>
    <div id="kbd-chord" class="sq-kbd-chord">
      <span class="sq-kbd-chord__lbl">chord</span>
      <select id="kbd-chord-type" title="chord mode — play each key as a chord (off = single notes)">
        <option value="">off</option>
        <option value="maj">maj</option>
        <option value="min">min</option>
        <option value="sus2">sus2</option>
        <option value="sus4">sus4</option>
        <option value="dim">dim</option>
        <option value="aug">aug</option>
        <option value="maj7">maj7</option>
        <option value="min7">min7</option>
        <option value="dom7">dom7</option>
        <option value="m7b5">m7b5</option>
        <option value="add9">add9</option>
      </select>
      <select id="kbd-chord-cpx" title="voicing / inversion">
        <option value="0">root</option>
        <option value="1">1st inv</option>
        <option value="2">2nd inv</option>
        <option value="3">3rd inv</option>
        <option value="4">drop-oct</option>
      </select>
      <span id="kbd-arp" class="sq-kbd-arp" hidden>
        <label class="sq-kbd-arp__toggle" title="arpeggiate chords played from the keyboard — the steps they land on are written as arps"><input id="kbd-arp-on" type="checkbox" /> arp</label>
        <span id="kbd-arp-opts" class="sq-kbd-arp__opts" hidden>
          <select id="kbd-arp-rate" title="arp rate (beats per note)">
            <option value="1">1/4</option>
            <option value="0.5">1/8</option>
            <option value="0.333">1/8t</option>
            <option value="0.25" selected>1/16</option>
            <option value="0.167">1/16t</option>
            <option value="0.125">1/32</option>
          </select>
          <select id="kbd-arp-range" title="octaves spanned">
            <option value="1" selected>1 oct</option>
            <option value="2">2 oct</option>
            <option value="3">3 oct</option>
            <option value="4">4 oct</option>
          </select>
          <select id="kbd-arp-dir" title="arp direction">
            <option value="up" selected>up</option>
            <option value="down">down</option>
            <option value="updown">up-down</option>
            <option value="random">random</option>
          </select>
        </span>
      </span>
    </div>
    <div id="status" class="sq-status sq-status--bar">click play to unlock audio</div>
    </div><!-- /sq-transport__kbd-row -->
  </header>

  <div class="sq-pattern-bar">
    <button id="pattern-menu-btn" class="sq-mobile-only" type="button" aria-label="session menu" title="open session menu">Session</button>
    <div class="sq-set__stack">
      <button id="bounce-audio" class="sq-btn--ghost sq-dl__btn" title="render the current pattern to audio and download it"><span class="sq-dl__icon"></span><span class="sq-dl__label">Pattern</span></button>
      <button id="bounce-track" class="sq-btn--ghost sq-dl__btn" title="chain through all non-empty patterns and render the whole arrangement"><span class="sq-dl__icon"></span><span class="sq-dl__label">Session</span></button>
    </div>
    <div class="sq-mode__stack">
      <div class="sq-mode__row">
        <button id="pattern-mode" class="sq-btn--ghost sq-icon-btn" aria-pressed="false" aria-label="pattern mode"></button>
        <button id="pattern-switch" class="sq-btn--ghost sq-icon-btn" aria-pressed="false" aria-label="switch mode"></button>
      </div>
      <button id="pattern-dup" class="sq-btn--ghost" title="duplicate current pattern into the next slot">dup</button>
    </div>
    <label class="sq-repeat__wrap" title="time signature for this pattern"><span>sig</span><select id="pattern-meter">
      <option value="4/4" selected>4/4</option>
      <option value="3/4">3/4</option>
      <option value="2/4">2/4</option>
      <option value="6/8">6/8</option>
      <option value="9/8">9/8</option>
      <option value="12/8">12/8</option>
      <option value="5/4">5/4</option>
      <option value="7/4">7/4</option>
      <option value="5/8">5/8</option>
      <option value="7/8">7/8</option>
    </select></label>
    <label class="sq-repeat__wrap" title="bars this pattern plays for before chain advances"><span>rep</span><input id="pattern-repeats" type="number" min="1" max="16" value="1" /></label>
    <div id="pattern-grid" class="sq-pattern__grid"></div>
  </div>


  <main id="tracks"></main>
  <div class="sq-add-track-row">
    <button id="add-track" class="sq-btn--ghost">+ add track</button>
  </div>

  <template id="track-template">
    <section class="sq-track">
      <div class="sq-track__head">
        <input class="sq-track__name" type="text" placeholder="track" />
        <select class="sq-track__engine"></select>
        <button class="sq-track__wav sq-icon-btn sq-btn--ghost" type="button" aria-label="sample / wave editor" title="sample / wave editor" disabled></button>
        <button class="sq-track__save sq-icon-btn sq-btn--ghost" aria-label="save patch" title="save the current custom patch"></button>
        <button class="sq-track__load-patch sq-icon-btn sq-btn--ghost" aria-label="load patch" title="load a saved patch into this track"></button>
        <div class="sq-field"><label>len</label><input class="sq-track__len" type="number" min="1" max="128" value="16" /></div>
        <div class="sq-track__len-extend">
          <button class="track-len-plus1 sq-btn--ghost" type="button" title="add one bar to this track's pattern (duplicates existing content)">+1</button>
          <button class="track-len-2x sq-btn--ghost" type="button" title="double this track's pattern length (duplicates content)">x2</button>
          <button class="track-len-4x sq-btn--ghost" type="button" title="quadruple this track's pattern length (duplicates content)">x4</button>
          <button class="track-len-half sq-btn--ghost" type="button" title="halve this track's pattern length (truncates to the first half)">/2</button>
          <button class="track-len-quarter sq-btn--ghost" type="button" title="quarter this track's pattern length (truncates to the first quarter)">/4</button>
        </div>
        <div class="sq-field"><label>spd</label>
          <select class="sq-track__speed">
            <option value="0.0625">1/16</option>
            <option value="0.125">1/8</option>
            <option value="0.25">1/4</option>
            <option value="0.5">1/2</option>
            <option value="1" selected>1</option>
            <option value="2">2</option>
            <option value="4">4</option>
            <option value="6">6</option>
            <option value="8">8</option>
            <option value="16">16</option>
          </select>
        </div>
        <div class="sq-field sq-vol__field"><label>vol</label>
          <div class="sq-vol-combo" title="volume (drag) + output level">
            <div class="sq-meter sq-track__meter"><div class="sq-meter__bar"></div></div>
            <input class="p-vol" type="range" min="0" max="1" step="0.01" value="0.8" />
          </div>
        </div>
        <div class="sq-track__synth-row">
        <div class="sq-param-group sq-param-group--timbre">
          <div class="sq-field"><label>harm</label><input class="p-harm" type="range" min="0" max="1" step="0.01" value="0.5" /></div>
          <div class="sq-field"><label>timb</label><input class="p-timb" type="range" min="0" max="1" step="0.01" value="0.5" /></div>
          <div class="sq-field"><label>morph</label><input class="p-morph" type="range" min="0" max="1" step="0.01" value="0.5" /></div>
          <div class="sq-field"><label>decay</label><input class="p-decay" type="range" min="0" max="1" step="0.01" value="0.4" /></div>
          <button class="track-rand sq-btn--ghost" title="randomize harm/timb/morph/decay">rand</button>
        </div>
        <div class="sq-param-group sq-param-group--osc-mix" hidden>
          <div class="sq-field"><label class="osc1-label">osc1</label><input class="p-osc1" type="range" min="0" max="1" step="0.01" value="0.55" /></div>
          <div class="sq-field"><label class="osc2-label">osc2</label><input class="p-osc2" type="range" min="0" max="1" step="0.01" value="0.45" /></div>
          <div class="sq-field"><label class="osc3-label">osc3</label><input class="p-osc3" type="range" min="0" max="1" step="0.01" value="0.35" /></div>
          <div class="sq-field osc4-field"><label class="osc4-label">sub</label><input class="p-osc4" type="range" min="0" max="1" step="0.01" value="0.4" /></div>
        </div>
        <div class="sq-param-group sq-param-group--osc-mod" hidden>
          <div class="sq-field"><label>ultra</label><input class="p-ultra" type="range" min="0" max="1" step="0.01" value="0.35" /></div>
          <div class="sq-field"><label>fm</label><input class="p-fm" type="range" min="0" max="1" step="0.01" value="0" /></div>
          <div class="sq-field"><label>metal</label><input class="p-metal" type="range" min="0" max="1" step="0.01" value="0" /></div>
        </div>
        <div class="sq-param-group sq-param-group--moog" hidden>
          <div class="sq-moog__osc-row">
            <span class="sq-moog__osc-lbl">osc1</span>
            <select class="p-osc1range" title="range / octave">
              <option value="-2">32'</option><option value="-1">16'</option><option value="0" selected>8'</option><option value="1">4'</option><option value="2">2'</option>
            </select>
            <select class="p-osc1wave" title="waveform">
              <option value="triangle">tri</option><option value="sawtooth" selected>saw</option><option value="square">sqr</option><option value="sine">sin</option>
            </select>
          </div>
          <div class="sq-moog__osc-row">
            <span class="sq-moog__osc-lbl">osc2</span>
            <label class="sq-moog__freq"><span>freq</span><input class="p-osc2freq" type="range" min="-7" max="7" step="1" value="0" /></label>
            <select class="p-osc2range" title="range / octave">
              <option value="-2">32'</option><option value="-1">16'</option><option value="0" selected>8'</option><option value="1">4'</option><option value="2">2'</option>
            </select>
            <select class="p-osc2wave" title="waveform">
              <option value="triangle">tri</option><option value="sawtooth" selected>saw</option><option value="square">sqr</option><option value="sine">sin</option>
            </select>
          </div>
          <div class="sq-moog__osc-row">
            <span class="sq-moog__osc-lbl">osc3</span>
            <label class="sq-moog__freq"><span>freq</span><input class="p-osc3freq" type="range" min="-7" max="7" step="1" value="0" /></label>
            <select class="p-osc3range" title="range / octave">
              <option value="-2">32'</option><option value="-1" selected>16'</option><option value="0">8'</option><option value="1">4'</option><option value="2">2'</option>
            </select>
            <select class="p-osc3wave" title="waveform">
              <option value="triangle" selected>tri</option><option value="sawtooth">saw</option><option value="square">sqr</option><option value="sine">sin</option>
            </select>
          </div>
          <div class="sq-field sq-moog__noise">
            <label>noise</label><input class="p-noise" type="range" min="0" max="1" step="0.01" value="0" />
            <select class="p-noisetype" title="noise color">
              <option value="white" selected>white</option><option value="pink">pink</option>
            </select>
          </div>
        </div>
        <div class="sq-param-group sq-param-group--virus" hidden>
          <div class="sq-virus__row">
            <span class="sq-virus__lbl">osc</span>
            <label class="sq-virus__f"><span>semi</span><input class="p-vosc2semi" type="range" min="-24" max="24" step="1" value="0" title="osc 2 pitch offset in semitones" /></label>
            <label class="sq-virus__f"><span>detune</span><input class="p-vosc2det" type="range" min="0" max="1" step="0.01" value="0.08" title="fine detune between the two oscillators — a little is what makes it sound wide rather than sterile" /></label>
            <label class="sq-virus__f"><span>pw</span><input class="p-vpw" type="range" min="0.02" max="0.98" step="0.01" value="0.5" title="pulse width. Only heard at the top of the shape morph, where the wave becomes a pulse" /></label>
            <label class="sq-virus__f"><span>fm</span><input class="p-vfm" type="range" min="0" max="1" step="0.01" value="0" title="osc 2 phase-modulates osc 1" /></label>
            <label class="sq-virus__f"><span>ring</span><input class="p-vring" type="range" min="0" max="1" step="0.01" value="0" title="ring modulation — osc 1 times osc 2, for clangorous metallic tones" /></label>
            <select class="p-vsync" title="hard sync: osc 2 is reset every time osc 1 completes a cycle, so it is forced to osc 1's pitch. Sweep the semi slider with sync on for the classic tearing lead">
              <option value="off" selected>sync off</option><option value="on">sync on</option>
            </select>
            <select class="p-vsubwave" title="sub oscillator waveform, one octave below osc 1 (its level is the sub slider)">
              <option value="square" selected>sub sqr</option><option value="triangle">sub tri</option>
            </select>
          </div>
          <div class="sq-virus__row">
            <span class="sq-virus__lbl">unison</span>
            <select class="p-vuni" title="how many detuned copies of the whole oscillator section each note plays — this is the hypersaw">
              <option value="1" selected>1</option><option value="2">2</option><option value="3">3</option>
              <option value="4">4</option><option value="6">6</option><option value="8">8</option>
            </select>
            <label class="sq-virus__f"><span>detune</span><input class="p-vunidet" type="range" min="0" max="1" step="0.01" value="0.3" title="how far the unison copies spread in pitch" /></label>
            <label class="sq-virus__f"><span>spread</span><input class="p-vunispread" type="range" min="0" max="1" step="0.01" value="0.6" title="how far the unison copies spread across the stereo field" /></label>
            <span class="sq-virus__lbl">env</span>
            <label class="sq-virus__f"><span>atk</span><input class="p-vatk" type="range" min="0" max="1" step="0.01" value="0.02" /></label>
            <label class="sq-virus__f"><span>sus</span><input class="p-vsus" type="range" min="0" max="1" step="0.01" value="0.6" /></label>
            <label class="sq-virus__f"><span>rel</span><input class="p-vrel" type="range" min="0" max="1" step="0.01" value="0.25" /></label>
            <label class="sq-virus__f"><span>env amt</span><input class="p-venvamt" type="range" min="-1" max="1" step="0.01" value="0.5" title="how much the envelope moves the cutoff. Negative sweeps downward" /></label>
          </div>
          <div class="sq-virus__row">
            <span class="sq-virus__lbl">filter 1</span>
            <select class="p-vmode1" title="filter 1 response">
              <option value="lp" selected>lp</option><option value="hp">hp</option><option value="bp">bp</option><option value="bs">bs</option>
            </select>
            <select class="p-vpoles" title="filter 1 slope: 2-pole is 12dB per octave, 4-pole is 24">
              <option value="2">2-pole</option><option value="4" selected>4-pole</option>
            </select>
            <span class="sq-virus__lbl">filter 2</span>
            <select class="p-vmode2" title="filter 2 response">
              <option value="lp" selected>lp</option><option value="hp">hp</option><option value="bp">bp</option><option value="bs">bs</option>
            </select>
            <label class="sq-virus__f"><span>cut 2</span><input class="p-vcut2" type="range" min="-1" max="1" step="0.01" value="0" title="filter 2's cutoff, offset from filter 1 by up to two octaves either way" /></label>
            <select class="p-vroute" title="how the two filters are connected: series (one into the other), parallel (both from the same source), or split (filter 1 to the left, filter 2 to the right)">
              <option value="ser" selected>series</option><option value="par">parallel</option><option value="split">split</option>
            </select>
            <label class="sq-virus__f"><span>balance</span><input class="p-vbal" type="range" min="0" max="1" step="0.01" value="0" title="crossfade between the two filters' outputs" /></label>
            <span class="sq-virus__lbl">sat</span>
            <select class="p-vsat" title="the saturation stage between the two filters — the Virus's signature. Filter 2 cleans up whatever this does to filter 1's output">
              <option value="off">off</option><option value="light">light</option><option value="soft" selected>soft</option>
              <option value="hard">hard</option><option value="digital">digital</option><option value="shaper">shaper</option>
              <option value="rectify">rectify</option><option value="bits">bit reduce</option><option value="rate">rate reduce</option>
            </select>
            <label class="sq-virus__f"><span>amt</span><input class="p-vsatamt" type="range" min="0" max="1" step="0.01" value="0.3" /></label>
          </div>
        </div>
${DX7_PANEL}
${GUITAR_PANEL}
${BASS_PANEL}
        <div class="sq-param-group sq-param-group--tb303" hidden>
          <div class="sq-field"><label>wave</label>
            <select class="p-wave303" title="the 303's two waveforms. Saw is the classic acid tone; square is hollower and sits lower">
              <option value="saw" selected>saw</option><option value="square">square</option>
            </select>
          </div>
          <div class="sq-field"><label>accent</label><input class="p-accent303" type="range" min="0" max="1" step="0.01" value="0.6" title="how hard an accented step hits. Accent makes the note louder, forces the filter decay to a fixed 200ms, and pushes a charge into the accent circuit — at high resonance consecutive accents pile up into a rising squelch" /></div>
          <div class="sq-field"><label>tune</label><input class="p-tune303" type="range" min="-50" max="50" step="1" value="0" title="master tuning, in cents" /></div>
        </div>
        <div class="sq-param-group sq-param-group--granular" hidden>
          <div class="sq-gran__row">
            <label class="sq-gran__lbl">play</label>
            <select class="p-gplay" title="fixed = every grain reads from one spot; moving = the play head scans through the sample">
              <option value="fixed" selected>fixed</option><option value="moving">moving</option>
            </select>
            <div class="sq-field"><label>speed</label><input class="p-gspeed" type="range" min="-2" max="2" step="0.01" value="1" title="how fast the play head travels through the sample, when play is set to moving. 1 = the sample&#39;s own speed, 0 = frozen, negative = backwards, up to 2x either way. Pitch is unaffected" /></div>
            <div class="sq-field"><label>pitch</label><input class="p-gpitch" type="range" min="-24" max="24" step="1" value="0" title="transposes every grain, in semitones, up or down two octaves. Independent of speed — the sample still plays through in the same time" /></div>
            <label class="sq-gran__lbl">loop</label>
            <select class="p-gloop" title="what the moving play head does at the end of the sample: stop, wrap to the start, or bounce back">
              <option value="none">none</option><option value="fwd" selected>fwd</option><option value="bidir">bidir</option>
            </select>
          </div>
          <div class="sq-gran__row">
            <div class="sq-field"><label>window</label><input class="p-gwindow" type="range" min="0" max="1" step="0.01" value="0.15" title="how far each grain may stray from the play head — the band drawn across the waveform. Narrow reads one instant over and over; at 100% the band is the whole sample, so grains come from anywhere in it" /></div>
            <div class="sq-field"><label>jitter</label><input class="p-gjitter" type="range" min="0" max="1" step="0.01" value="0.1" title="randomises when each grain fires. At zero the grain train is perfectly regular and hums a tone at the grain rate; raise it to break that up into texture" /></div>
            <div class="sq-field"><label>detune</label><input class="p-gdetune" type="range" min="0" max="1" step="0.01" value="0" title="random pitch per grain, up to a semitone either way — thickens a cloud into a chorus" /></div>
            <div class="sq-field"><label>pan</label><input class="p-gpan" type="range" min="0" max="1" step="0.01" value="0.3" title="random stereo placement per grain — widens the cloud without touching its tone" /></div>
          </div>
          <div class="sq-gran__row">
            <label class="sq-gran__lbl">pattern</label>
            <select class="p-gpattern" title="sprinkles octave or fifth jumps across the grains, for a harmonised cloud rather than a flat one">
              <option value="none" selected>none</option><option value="oct">octaves</option><option value="fifth">fifths</option>
            </select>
            <label class="sq-gran__sync" title="lock the grain rate to the tempo instead of the dense slider — rhythmic granulation rather than a wash"><input class="p-gsync" type="checkbox" title="lock the grain rate to the tempo instead of the dense slider — rhythmic granulation rather than a wash" /> sync</label>
            <label class="sq-gran__lbl">rate</label>
            <select class="p-grate" title="grain rate as a division of the tempo, used while sync is on (dense does nothing then)">
              <option value="1/64">1/64</option><option value="1/32t">1/32T</option><option value="1/32">1/32</option>
              <option value="1/16t">1/16T</option><option value="1/16" selected>1/16</option><option value="1/8t">1/8T</option>
              <option value="1/8">1/8</option><option value="1/4t">1/4T</option><option value="1/4">1/4</option>
              <option value="1/2t">1/2T</option><option value="1/2">1/2</option><option value="1bar">1 bar</option>
              <option value="2bar">2 bar</option><option value="4bar">4 bar</option><option value="8bar">8 bar</option>
            </select>
          </div>
        </div>
        </div><!-- /track-synth-row -->
        <button class="sq-track__solo sq-btn--ghost" aria-pressed="false" title="solo">solo</button>
        <button class="sq-track__mute sq-btn--ghost">mute</button>
        <button class="sq-track__plock sq-btn--ghost" aria-pressed="false" title="p-lock: give this track its own sound in THIS pattern. Normally a track has one sound and 32 patterns of notes — change the cutoff and it changes everywhere. Locked, this pattern keeps its own params, filter, fx, eq, comp and mod settings, while every unlocked pattern goes on sharing the track's. It is per pattern, so the button changes as you move between them. Unlocking hands the pattern back to the track's sound and keeps what it had, so locking again brings it straight back">p-lock</button>
        <button class="sq-track__clear sq-btn--ghost">clear</button>
        <button class="track-dice sq-icon-btn sq-btn--ghost" type="button" aria-label="random pattern, drag up or down to set density" title="random pattern (drag up/down to set density)"></button>
        <button class="sq-track__dup sq-btn--ghost" type="button" title="duplicate this track">dup</button>
        <button class="sq-track__remove sq-btn--ghost sq-btn--danger">remove</button>
        <div class="sq-track__oct">
          <button class="track-oct-down sq-btn--ghost" type="button" title="shift every step down an octave">oct −</button>
          <button class="track-oct-up sq-btn--ghost" type="button" title="shift every step up an octave">oct +</button>
          <button class="track-semi-down sq-btn--ghost" type="button" title="shift every step down a semitone">semi −</button>
          <button class="track-semi-up sq-btn--ghost" type="button" title="shift every step up a semitone">semi +</button>
        </div>
        <div class="sq-panel__btn-group">
          <button class="sq-track__roll sq-btn--ghost" aria-pressed="false" title="piano roll: click cells to place notes per step">roll</button>
          <button class="sq-track__filter sq-btn--ghost" aria-pressed="false" title="filter">filter</button>
          <button class="sq-track__env sq-btn--ghost" aria-pressed="false" title="envelope → cutoff">env</button>
          <button class="sq-track__fx sq-btn--ghost" aria-pressed="false" title="fx rack">fx</button>
          <button class="sq-track__eq sq-btn--ghost" aria-pressed="false" title="3-band eq">eq</button>
          <button class="sq-track__comp sq-btn--ghost" aria-pressed="false" title="compressor + sidechain">comp</button>
          <button class="sq-track__mod sq-btn--ghost" aria-pressed="false">mod</button>
          <button class="track-aut sq-btn--ghost" aria-pressed="false" title="per-step automation">aut</button>
        </div>
      </div>
      <div class="sq-track__midi sq-field" hidden>
        <label>midi out</label>
        <select class="midi-out"></select>
        <label>ch</label>
        <input class="midi-ch" type="number" min="1" max="16" value="1" />
      </div>
      <div class="sq-track__mod-panel" hidden></div>
      <div class="sq-track__aut-panel" hidden></div>
      <div class="sq-track__roll-panel" hidden></div>
      <div class="sq-track__filter-panel" hidden>
        <div class="sq-fx__row" data-fx="filter">
          <span class="sq-fx__title">filter (resonant lp)</span>
          <label class="sq-fx__ctl"><span>cut</span><input class="p-cutoff" type="range" min="0" max="1" step="0.001" value="1" /></label>
          <label class="sq-fx__ctl"><span>res</span><input class="p-reson" type="range" min="0" max="1" step="0.01" value="0" /></label>
        </div>
      </div>
      <div class="sq-track__env-panel" hidden>
        <div class="sq-fx__row" data-fx="env">
          <span class="sq-fx__title">envelope (adsr → cutoff)</span>
          <label class="sq-fx__ctl"><span>env</span><input class="p-envamt" type="range" min="0" max="1" step="0.01" value="0" /></label>
          <label class="sq-fx__ctl"><span>A</span><input class="p-envatk" type="range" min="0" max="1" step="0.01" value="0" /></label>
          <label class="sq-fx__ctl"><span>D</span><input class="p-envdec" type="range" min="0" max="1" step="0.01" value="0.25" /></label>
          <label class="sq-fx__ctl"><span>S</span><input class="p-envsus" type="range" min="0" max="1" step="0.01" value="0.4" /></label>
          <label class="sq-fx__ctl"><span>R</span><input class="p-envrel" type="range" min="0" max="1" step="0.01" value="0.3" /></label>
        </div>
      </div>
      <div class="sq-track__eq-panel" hidden>
        <div class="sq-fx__row" data-fx="eq">
          <span class="sq-fx__title">eq (3-band)</span>
          <label class="sq-fx__ctl"><span>low</span><input class="p-eq-low" type="range" min="-18" max="18" step="0.5" value="0" /></label>
          <label class="sq-fx__ctl"><span>mid</span><input class="p-eq-mid" type="range" min="-18" max="18" step="0.5" value="0" /></label>
          <label class="sq-fx__ctl"><span>high</span><input class="p-eq-high" type="range" min="-18" max="18" step="0.5" value="0" /></label>
        </div>
      </div>
      <div class="sq-track__comp-panel" hidden>
        <div class="sq-fx__row" data-fx="comp">
          <span class="sq-fx__title">compressor</span>
          <label class="sq-fx__ctl"><span>on</span><input class="comp-enabled" type="checkbox" /></label>
          <label class="sq-fx__ctl"><span>src</span><select class="sq-comp__source"><option value="self">self</option></select></label>
        </div>
        <div class="sq-fx__row" data-fx="comp">
          <span class="sq-fx__title"></span>
          <label class="sq-fx__ctl"><span>thr</span><input class="comp-threshold" type="range" min="-60" max="0" step="1" value="-20" /></label>
          <label class="sq-fx__ctl"><span>ratio</span><input class="comp-ratio" type="range" min="1" max="20" step="0.1" value="4" /></label>
          <label class="sq-fx__ctl"><span>atk</span><input class="comp-attack" type="range" min="0" max="1" step="0.005" value="0.01" /></label>
          <label class="sq-fx__ctl"><span>rel</span><input class="comp-release" type="range" min="0.02" max="2" step="0.01" value="0.2" /></label>
          <label class="sq-fx__ctl"><span>knee</span><input class="comp-knee" type="range" min="0" max="30" step="1" value="6" /></label>
        </div>
      </div>
      <div class="sq-track__fx-panel" hidden>
        <div class="sq-fx__row" data-fx="glide">
          <span class="sq-fx__title">glide</span>
          <label class="sq-fx__ctl"><span>time</span><input class="sq-track__glide" type="range" min="0" max="0.5" step="0.005" value="0" /></label>
        </div>
        <div class="sq-fx__row" data-fx="amp">
          <span class="sq-fx__title">amp</span>
          <label class="sq-fx__ctl" title="input drive — hits every effect below harder (fuzz, shaper, cassette sat, crush all respond). Centre = unity, full = +18dB"><span>drive</span><input class="fx-amp-preamp" type="range" min="0" max="1" step="0.01" value="0.5" /></label>
          <label class="sq-fx__ctl" title="output level after the whole chain — trims back what drive adds. Centre = unity, full = +6dB"><span>out</span><input class="fx-amp-level" type="range" min="0" max="1" step="0.01" value="0.5" /></label>
        </div>
        <div class="sq-fx__row" data-fx="vinyl">
          <span class="sq-fx__title">vinyl sim</span>
          <label class="sq-fx__ctl"><span>amt</span><input class="fx-vinyl-amount" type="range" min="0" max="1" step="0.01" value="0" /></label>
          <label class="sq-fx__ctl"><span>warmth</span><input class="fx-vinyl-warmth" type="range" min="0" max="1" step="0.01" value="0.4" /></label>
          <label class="sq-fx__ctl"><span>wow</span><input class="fx-vinyl-wow" type="range" min="0" max="1" step="0.01" value="0.3" /></label>
        </div>
        <div class="sq-fx__row" data-fx="cassette">
          <span class="sq-fx__title">cassette</span>
          <label class="sq-fx__ctl"><span>amt</span><input class="fx-cassette-amount" type="range" min="0" max="1" step="0.01" value="0" /></label>
          <label class="sq-fx__ctl"><span>flutter</span><input class="fx-cassette-flutter" type="range" min="0" max="1" step="0.01" value="0.3" /></label>
          <label class="sq-fx__ctl"><span>sat</span><input class="fx-cassette-sat" type="range" min="0" max="1" step="0.01" value="0.4" /></label>
        </div>
        <div class="sq-fx__row" data-fx="fuzz">
          <span class="sq-fx__title">fuzz (dba-style)</span>
          <label class="sq-fx__ctl"><span>amt</span><input class="fx-fuzz-amount" type="range" min="0" max="1" step="0.01" value="0" /></label>
          <label class="sq-fx__ctl"><span>drive</span><input class="fx-fuzz-drive" type="range" min="0" max="1" step="0.01" value="0.7" /></label>
          <label class="sq-fx__ctl"><span>tone</span><input class="fx-fuzz-tone" type="range" min="0" max="1" step="0.01" value="0.4" /></label>
          <label class="sq-fx__ctl"><span>level</span><input class="fx-fuzz-level" type="range" min="0" max="1" step="0.01" value="0.5" /></label>
        </div>
        <div class="sq-fx__row" data-fx="ringmod">
          <span class="sq-fx__title">ring mod</span>
          <label class="sq-fx__ctl"><span>wet</span><input class="fx-ringmod-wet" type="range" min="0" max="1" step="0.01" value="0" /></label>
          <label class="sq-fx__ctl"><span>freq</span><input class="fx-ringmod-freq" type="range" min="0" max="1" step="0.01" value="0.35" /></label>
        </div>
        <div class="sq-fx__row" data-fx="shaper">
          <span class="sq-fx__title">wave shaper</span>
          <label class="sq-fx__ctl"><span>wet</span><input class="fx-shaper-wet" type="range" min="0" max="1" step="0.01" value="0" /></label>
          <label class="sq-fx__ctl"><span>pre</span><input class="fx-shaper-preamp" type="range" min="0" max="1" step="0.01" value="0.5" /></label>
          <label class="sq-fx__ctl"><span>amt</span><input class="fx-shaper-amt" type="range" min="0" max="1" step="0.01" value="0.5" /></label>
          <label class="sq-fx__ctl"><span>mode</span><select class="fx-shaper-mode">
            <option value="saturate">saturate</option>
            <option value="softclip">soft clip</option>
            <option value="clip">clip</option>
            <option value="serge">serge</option>
            <option value="fold" selected>fold</option>
            <option value="wrap">wrap</option>
          </select></label>
        </div>
        <div class="sq-fx__row" data-fx="crush">
          <span class="sq-fx__title">bitcrush</span>
          <label class="sq-fx__ctl"><span>wet</span><input class="fx-crush-wet" type="range" min="0" max="1" step="0.01" value="0" /></label>
          <label class="sq-fx__ctl"><span>bits</span><input class="fx-crush-bits" type="range" min="1" max="16" step="1" value="8" /></label>
        </div>
        <div class="sq-fx__row" data-fx="autowah">
          <span class="sq-fx__title">auto-wah</span>
          <label class="sq-fx__ctl"><span>wet</span><input class="fx-autowah-wet" type="range" min="0" max="1" step="0.01" value="0" /></label>
          <label class="sq-fx__ctl"><span>sens</span><input class="fx-autowah-sens" type="range" min="0" max="1" step="0.01" value="0.5" /></label>
          <label class="sq-fx__ctl"><span>range</span><input class="fx-autowah-range" type="range" min="0" max="1" step="0.01" value="0.5" /></label>
        </div>
        <div class="sq-fx__row" data-fx="chorus">
          <span class="sq-fx__title">chorus</span>
          <label class="sq-fx__ctl"><span>wet</span><input class="fx-chorus-wet" type="range" min="0" max="1" step="0.01" value="0" /></label>
          <label class="sq-fx__ctl"><span>rate</span><input class="fx-chorus-rate" type="range" min="0" max="1" step="0.01" value="0.5" /></label>
          <label class="sq-fx__ctl"><span>depth</span><input class="fx-chorus-depth" type="range" min="0" max="1" step="0.01" value="0.5" /></label>
        </div>
        <div class="sq-fx__row" data-fx="phaser">
          <span class="sq-fx__title">phaser</span>
          <label class="sq-fx__ctl"><span>wet</span><input class="fx-phaser-wet" type="range" min="0" max="1" step="0.01" value="0" /></label>
          <label class="sq-fx__ctl"><span>rate</span><input class="fx-phaser-rate" type="range" min="0" max="1" step="0.01" value="0.3" /></label>
          <label class="sq-fx__ctl"><span>depth</span><input class="fx-phaser-depth" type="range" min="0" max="1" step="0.01" value="0.5" /></label>
        </div>
        <div class="sq-fx__row" data-fx="flanger">
          <span class="sq-fx__title">flanger</span>
          <label class="sq-fx__ctl"><span>wet</span><input class="fx-flanger-wet" type="range" min="0" max="1" step="0.01" value="0" /></label>
          <label class="sq-fx__ctl"><span>rate</span><input class="fx-flanger-rate" type="range" min="0" max="1" step="0.01" value="0.3" /></label>
          <label class="sq-fx__ctl"><span>fbk</span><input class="fx-flanger-fbk" type="range" min="0" max="1" step="0.01" value="0.5" /></label>
        </div>
        <div class="sq-fx__row" data-fx="pitchshift">
          <span class="sq-fx__title">pitch shift</span>
          <label class="sq-fx__ctl"><span>wet</span><input class="fx-pitchshift-wet" type="range" min="0" max="1" step="0.01" value="0" /></label>
          <label class="sq-fx__ctl"><span>semi</span><input class="fx-pitchshift-semi" type="range" min="-12" max="12" step="1" value="0" /></label>
        </div>
        <div class="sq-fx__row" data-fx="delay">
          <span class="sq-fx__title">delay</span>
          <label class="sq-fx__ctl"><span>wet</span><input class="fx-delay-wet" type="range" min="0" max="1" step="0.01" value="0" /></label>
          <label class="sq-fx__ctl"><span>time</span><input class="fx-delay-time" type="range" min="0.05" max="1" step="0.005" value="0.375" /></label>
          <label class="sq-fx__ctl"><span>fbk</span><input class="fx-delay-fbk" type="range" min="0" max="0.95" step="0.01" value="0.35" /></label>
          <label class="sq-fx__ctl sq-fx__sync-wrap"><input class="fx-delay-sync" type="checkbox" /><span>sync</span></label>
          <select class="fx-delay-div">
            <option value="1">1/4</option>
            <option value="0.5">1/8</option>
            <option value="0.75">1/8d</option>
            <option value="0.333">1/8t</option>
            <option value="0.25">1/16</option>
            <option value="0.125">1/32</option>
          </select>
        </div>
        <div class="sq-fx__row" data-fx="reverb">
          <span class="sq-fx__title">reverb</span>
          <label class="sq-fx__ctl"><span>wet</span><input class="fx-reverb-wet" type="range" min="0" max="1" step="0.01" value="0" /></label>
          <label class="sq-fx__ctl"><span>decay</span><input class="fx-reverb-decay" type="range" min="0.2" max="8" step="0.1" value="2" /></label>
        </div>
      </div>
      <div class="sq-steps"></div>
    </section>
  </template>

  <template id="lfo-row-template">
    <div class="sq-lfo__row">
      <label class="sq-lfo__target"></label>
      <label class="sq-lfo__enable">
        <input type="checkbox" class="lfo-on" />
        on
      </label>
      <select class="sq-lfo__shape">
        <option value="sine">sine</option>
        <option value="triangle">triangle</option>
        <option value="sawtooth">saw</option>
        <option value="square">square</option>
      </select>
      <label class="sq-lfo__sync-wrap">
        <input type="checkbox" class="lfo-sync" />
        sync
      </label>
      <div class="sq-field sq-lfo__rate-field">
        <label>rate</label>
        <input class="sq-lfo__rate" type="range" min="0" max="1" step="0.001" value="0.35" />
        <select class="sq-lfo__div">
          <option value="16">4 bars</option>
          <option value="8">2 bars</option>
          <option value="4">1 bar</option>
          <option value="2">1/2</option>
          <option value="1" selected>1/4 (beat)</option>
          <option value="0.5">1/8</option>
          <option value="0.25">1/16</option>
          <option value="0.125">1/32</option>
        </select>
        <span class="sq-lfo__rate-label">1.00 hz</span>
      </div>
      <div class="sq-field">
        <label>depth</label>
        <input class="lfo-depth" type="range" min="0" max="1" step="0.01" value="0.5" />
        <span class="sq-lfo__depth-label">0.50</span>
      </div>
      <button class="sq-lfo__remove sq-btn--ghost" type="button" title="remove this modulation">×</button>
    </div>
  </template>

  <!-- iOS audio session unlock: play() on this element inside a user gesture
       switches Safari from "ambient" (ringer-controlled, silenced when the
       side switch is on silent) to "playback" mode, which routes AudioContext
       output through the regular media volume and ignores the ringer switch.
       The element loops a 1-second silent WAV generated at runtime (see
       initSilentAudioLoop in js/main.js) — looping keeps the audio session
       continuously active, which prevents iOS from quietly deactivating the
       renderer between the unlock tap and the first transport hit. Without an
       active session, ctx.state reads "running" but no samples are emitted
       until something forces a session re-eval (e.g., tab switch). -->
  <audio id="ios-audio-unlock" playsinline preload="auto" loop></audio>
`;
