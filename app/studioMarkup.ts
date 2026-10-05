// AUTO-PORTED from the original public/index.html <body> (scripts stripped).
// This is the exact static DOM skeleton the vanilla engine (public/js/main.js)
// queries by id/class at boot. Rendered server-side via dangerouslySetInnerHTML;
// the three engine <script>s are injected client-side by ScriptLoader in order.
// The hexop's operator matrix: six operators by eight controls. Written as a loop
// rather than 54 hand-copied inputs — the columns only differ by operator
// number, and a typo in one of them would be invisible until that operator
// stopped responding. The algorithm and preset dropdowns are filled at runtime
// (populateHexopSelects in render.js) so their lists live only in hexop.js.
// Ranges and defaults must match HEXOP_DEFAULTS there.
const HEXOP_OP_COLS: Array<{ k: string; min: string; max: string; step: string; head: string; title: string }> = [
  { k: "lvl", min: "0", max: "1", step: "0.01", head: "level",
    title: "the operator's output level, and the control that matters most here. It is exponential: half the slider is a sixteenth of full scale, so the useful range is all at the top. Volume for a carrier, modulation depth for a modulator" },
  { k: "rat", min: "0", max: "31", step: "1", head: "ratio",
    title: "frequency as a multiple of the note, 1 to 31. The bottom step is a half ratio, an octave down. Whole numbers stay pitched. The ratios that do not divide are where bells and mallets come from" },
  { k: "fin", min: "0", max: "0.99", step: "0.01", head: "fine",
    title: "fine ratio, up to one whole ratio above the coarse setting. A modulator at 3.5 instead of 3 is a bell instead of an organ" },
  { k: "det", min: "-7", max: "7", step: "1", head: "det",
    title: "detune, seven steps of about 1.75 cents either way. Two operators on the same ratio, detuned apart, beat against each other" },
  { k: "atk", min: "0", max: "1", step: "0.01", head: "atk",
    title: "how long this operator takes to reach full level. On a modulator it sets how long the tone takes to open up: brass swell against struck bell" },
  { k: "dec", min: "0", max: "1", step: "0.01", head: "dec",
    title: "how fast it falls from full level to its sustain. A modulator decaying under a steady carrier is how an FM electric piano works" },
  { k: "sus", min: "0", max: "1", step: "0.01", head: "sus",
    title: "the level this operator holds at while the note lasts. Zero is percussive, high is sustained" },
  { k: "rel", min: "0", max: "1", step: "0.01", head: "rel",
    title: "how long this operator takes to fade once the note ends" },
];
const HEXOP_OP_DEFAULTS: Record<string, (op: number) => string> = {
  lvl: (i) => (i === 1 ? "1" : i === 2 ? "0.72" : "0"),
  rat: () => "1", fin: () => "0", det: () => "0",
  atk: () => "0.01", dec: () => "0.45",
  sus: (i) => (i === 1 ? "0.8" : "0.4"), rel: () => "0.3",
};
const hexopOpRows = () => [1, 2, 3, 4, 5, 6].map(i => `
          <div class="sq-hexop__oprow" data-op="${i}">
            <span class="sq-hexop__opn">op ${i}</span>
${HEXOP_OP_COLS.map(c => `            <label class="sq-hexop__f"><input class="p-d${i}${c.k}" type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${HEXOP_OP_DEFAULTS[c.k](i)}" title="${c.title}" /></label>`).join("\n")}
            <select class="p-d${i}fix" title="ratio mode tunes this operator to the note. Fixed mode pins it to a frequency between 1Hz and 10kHz, set by ratio and fine, whatever note you play, ignoring the pitch envelope and the lfo">
              <option value="ratio" selected>ratio</option><option value="fixed">fixed</option>
            </select>
          </div>`).join("");

const HEXOP_PANEL = `
        <div class="sq-param-group sq-param-group--hexop" hidden>
          <div class="sq-hexop__row">
            <span class="sq-hexop__lbl">alg</span>
            <select class="p-dalg" title="which of the 32 fixed wirings the six operators run in. 1←2 means operator 2 modulates operator 1. Anything with no arrow into it is a carrier"></select>
            <span class="sq-hexop__alg"></span>
            <span class="sq-hexop__lbl">voice</span>
            <select class="sq-hexop__preset" title="load a complete voice: all six operators, the algorithm and the four sliders"></select>
          </div>
          <div class="sq-hexop__row">
            <label class="sq-hexop__f"><span>key scale</span><input class="p-dks" type="range" min="0" max="1" step="0.01" value="0.35" title="how much the modulators pull back as you play up the keyboard" /></label>
            <label class="sq-hexop__f"><span>vel</span><input class="p-dvs" type="range" min="0" max="1" step="0.01" value="0.5" title="how much playing harder raises the modulation index, so a hard note is brighter rather than louder" /></label>
            <label class="sq-hexop__f"><span>pitch env</span><input class="p-dpeg" type="range" min="-1" max="1" step="0.01" value="0" title="a pitch sweep at the start of every note, up to two octaves either way" /></label>
            <label class="sq-hexop__f"><span>rate</span><input class="p-dpegr" type="range" min="0" max="1" step="0.01" value="0.3" title="how fast that pitch sweep settles back to the note" /></label>
          </div>
          <div class="sq-hexop__row">
            <span class="sq-hexop__lbl">lfo</span>
            <select class="p-dlfow" title="lfo waveform. One lfo for the whole instrument">
              <option value="tri" selected>tri</option><option value="sine">sine</option>
              <option value="sawdn">saw dn</option><option value="sawup">saw up</option>
              <option value="square">square</option><option value="sh">s+h</option>
            </select>
            <label class="sq-hexop__f"><span>speed</span><input class="p-dlfor" type="range" min="0" max="1" step="0.01" value="0.35" title="lfo speed, from a slow drift up to 24Hz" /></label>
            <label class="sq-hexop__f"><span>delay</span><input class="p-dlfod" type="range" min="0" max="1" step="0.01" value="0" title="how long the lfo takes to fade in after a note starts" /></label>
            <label class="sq-hexop__f"><span>pitch</span><input class="p-dpmd" type="range" min="0" max="1" step="0.01" value="0" title="how far the lfo moves the pitch, up to a semitone" /></label>
            <label class="sq-hexop__f"><span>amp</span><input class="p-damd" type="range" min="0" max="1" step="0.01" value="0" title="how far the lfo moves the level" /></label>
            <select class="p-dlfok" title="key sync restarts the lfo on every note. Off leaves one free-running lfo that notes join wherever it is">
              <option value="on" selected>key sync</option><option value="off">free run</option>
            </select>
          </div>
          <div class="sq-hexop__ops">
            <div class="sq-hexop__ophead">
              <span></span>
${HEXOP_OP_COLS.map(c => `              <span>${c.head}</span>`).join("\n")}
              <span></span>
            </div>${hexopOpRows()}
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
            <select class="sq-guitar__tone" title="load a rig: pickup, pick position, amp, drive, cab and the four track sliders"></select>
          </div>
          <div class="sq-guitar__row">
            <span class="sq-guitar__lbl">string</span>
            <label class="sq-guitar__f"><span>pick pos</span><input class="p-gtpick" type="range" min="0.02" max="0.5" step="0.01" value="0.28" title="where along the string you pick, from hard by the bridge to over the twelfth fret. Bridge is thin and cutting, neck is round" /></label>
            <label class="sq-guitar__f"><span>pick</span><input class="p-gtpnoise" type="range" min="0" max="1" step="0.01" value="0.5" title="what is striking the string: thumb at the bottom, plectrum at the top, setting how much high-frequency energy the pluck puts in" /></label>
            <label class="sq-guitar__f"><span>stiff</span><input class="p-gtstiff" type="range" min="0" max="1" step="0.01" value="0.25" title="string stiffness: how far the harmonics sit sharp of the arithmetic. A little is a wound low string, a lot goes piano-like" /></label>
            <label class="sq-guitar__f"><span>pkup pos</span><input class="p-gtpkup" type="range" min="0.02" max="0.5" step="0.01" value="0.12" title="where along the string the pickup sits: bridge at the bottom, neck at the top" /></label>
            <select class="p-gtpkupt" title="which pickup, and so where its resonance sits: a single coil peaks around 6kHz, a humbucker around 3">
              <option value="single">single coil</option><option value="hum" selected>humbucker</option><option value="p90">p90</option>
            </select>
            <label class="sq-guitar__f"><span>palm</span><input class="p-gtmute" type="range" min="0" max="1" step="0.01" value="0" title="the heel of the picking hand resting on the strings at the bridge. Shorter, darker and tighter" /></label>
          </div>
          <div class="sq-guitar__row">
            <span class="sq-guitar__lbl">amp</span>
            <select class="p-gtamp" title="which amp. They differ in gain, where the tone stack works, how asymmetrically the first stage clips, and whether the distortion is preamp or power amp">
              <option value="clean">clean</option><option value="tweed">tweed</option>
              <option value="brit" selected>brit</option><option value="hi">hi-gain</option>
              <option value="jazz">jazz</option>
            </select>
            <label class="sq-guitar__f"><span>bass</span><input class="p-gtbass" type="range" min="0" max="1" step="0.01" value="0.5" title="the amp's bass control. It sits after the first gain stage, so it shapes what is already distorted" /></label>
            <label class="sq-guitar__f"><span>mid</span><input class="p-gtmid" type="range" min="0" max="1" step="0.01" value="0.5" title="the amp's mid control, at whichever frequency this amp puts it" /></label>
            <label class="sq-guitar__f"><span>treble</span><input class="p-gttreb" type="range" min="0" max="1" step="0.01" value="0.5" title="the amp's treble control" /></label>
            <label class="sq-guitar__f"><span>presence</span><input class="p-gtpres" type="range" min="0" max="1" step="0.01" value="0.4" title="presence: a treble control inside the power amp's feedback loop rather than the tone stack. It works on the distortion, so it bites where treble only brightens" /></label>
            <label class="sq-guitar__f"><span>master</span><input class="p-gtmast" type="range" min="0" max="1" step="0.01" value="0.5" title="how hard the power amp is driven. Softer than preamp gain" /></label>
            <label class="sq-guitar__f"><span>sag</span><input class="p-gtsag" type="range" min="0" max="1" step="0.01" value="0.3" title="how far the power supply droops under load. The note ducks as it is struck and swells back as it decays" /></label>
          </div>
          <div class="sq-guitar__row">
            <span class="sq-guitar__lbl">cab</span>
            <select class="p-gtcab" title="the speaker, and the biggest filter in the chain: nothing below about 90Hz or above 5kHz survives it">
              <option value="4x12" selected>4x12</option><option value="2x12">2x12</option>
              <option value="1x12">1x12</option><option value="1x8">1x8</option><option value="di">di (no cab)</option>
            </select>
            <label class="sq-guitar__f"><span>mic</span><input class="p-gtmic" type="range" min="0" max="1" step="0.01" value="0.35" title="where the mic sits in front of the speaker: off-axis at the bottom, dead centre at the top" /></label>
            <label class="sq-guitar__f"><span>trem</span><input class="p-gttrem" type="range" min="0" max="1" step="0.01" value="0" title="amp tremolo: level wobble after the power tubes" /></label>
            <label class="sq-guitar__f"><span>rate</span><input class="p-gttremr" type="range" min="0" max="1" step="0.01" value="0.4" title="tremolo speed, 1.5Hz to about 13Hz" /></label>
            <select class="p-gttremw" title="tremolo shape. A sine wobbles, a square chops">
              <option value="sine" selected>sine</option><option value="square">square</option>
            </select>
            <label class="sq-guitar__f"><span>spring</span><input class="p-gtsprg" type="range" min="0" max="1" step="0.01" value="0" title="spring reverb in the amp: clangy and dispersive where the rack's reverb is smooth" /></label>
          </div>
        </div>`;

// The electric bass's rig. Same arrangement as the guitar panel above — the
// tone dropdown ships empty and is filled at runtime from BASS_TONE_NAMES, and
// the ranges and defaults must match BASS_NUM_CTLS in public/js/bass.js.
const BASS_PANEL = `
        <div class="sq-param-group sq-param-group--bass" hidden>
          <div class="sq-bass__row">
            <span class="sq-bass__lbl">tone</span>
            <select class="sq-bass__tone" title="load a rig: the bass, its strings, how it is played, the amp and the compression"></select>
          </div>
          <div class="sq-bass__row">
            <span class="sq-bass__lbl">hand</span>
            <label class="sq-bass__f"><span>pluck pos</span><input class="p-bspick" type="range" min="0.02" max="0.5" step="0.01" value="0.14" title="where along the string it is plucked, bridge to neck. Bridge is nasal, neck is round" /></label>
            <label class="sq-bass__f"><span>hand</span><input class="p-bsattack" type="range" min="0" max="1" step="0.01" value="0.4" title="what is hitting the string: thumb at the bottom, fingers in the middle, plectrum at the top" /></label>
            <label class="sq-bass__f"><span>fret</span><input class="p-bsfret" type="range" min="0" max="1" step="0.01" value="0.25" title="how hard the string is allowed to clatter against the frets. Wound right up, with a thumb, it is slap" /></label>
            <label class="sq-bass__f"><span>stiff</span><input class="p-bsstiff" type="range" min="0" max="1" step="0.01" value="0.45" title="string stiffness: how far the harmonics sit sharp of the arithmetic, and so the gap between the pitch and the clank" /></label>
            <label class="sq-bass__f"><span>pkup pos</span><input class="p-bspkup" type="range" min="0.02" max="0.5" step="0.01" value="0.1" title="which pickup, as a position along the string: bridge at the bottom, neck at the top" /></label>
            <select class="p-bspkupt" title="which pickup, and so where its resonance sits: a jazz single coil peaks high and growls, a precision's split humbucker sits low and thick, a musicman is the hi-fi one">
              <option value="j">jazz</option><option value="p" selected>precision</option><option value="mm">musicman</option>
            </select>
            <select class="p-bsstrs" title="roundwound or flatwound. Flats lose their top almost as soon as they are struck and have far less clank">
              <option value="round" selected>roundwound</option><option value="flat">flatwound</option>
            </select>
            <label class="sq-bass__f"><span>palm</span><input class="p-bsmute" type="range" min="0" max="1" step="0.01" value="0" title="the palm resting on the strings by the bridge. Shorter and darker" /></label>
          </div>
          <div class="sq-bass__row">
            <span class="sq-bass__lbl">dirt</span>
            <label class="sq-bass__f"><span>grind</span><input class="p-bsgrind" type="range" min="0" max="1" step="0.01" value="0" title="how much distortion is mixed in. It only works above the crossover, and the clean lows go back underneath" /></label>
            <label class="sq-bass__f"><span>xover</span><input class="p-bsxover" type="range" min="0" max="1" step="0.01" value="0.4" title="where the dirt starts, 120Hz to about 1.4kHz. Low is a fully dirty bass, high is a clean instrument with a snarl on top" /></label>
            <label class="sq-bass__f"><span>sub</span><input class="p-bssub" type="range" min="0" max="1" step="0.01" value="0" title="an octave below the note, tracked and following the string's own level" /></label>
          </div>
          <div class="sq-bass__row">
            <span class="sq-bass__lbl">amp</span>
            <select class="p-bsamp" title="which amp: a clean preamp with no colour, a small valve flip-top, a big valve stack, or a solid-state one that grinds">
              <option value="di">di</option><option value="flip">flip-top</option>
              <option value="svt" selected>svt</option><option value="gk">gk</option>
            </select>
            <label class="sq-bass__f"><span>bass</span><input class="p-bsbass" type="range" min="0" max="1" step="0.01" value="0.5" title="the amp's bass control" /></label>
            <label class="sq-bass__f"><span>lo mid</span><input class="p-bslomid" type="range" min="0" max="1" step="0.01" value="0.5" title="low mids, around 250Hz. Where a bass gets its weight or its mud" /></label>
            <label class="sq-bass__f"><span>hi mid</span><input class="p-bshimid" type="range" min="0" max="1" step="0.01" value="0.5" title="high mids, around 800Hz, where the note becomes audible on a small speaker" /></label>
            <label class="sq-bass__f"><span>treble</span><input class="p-bstreb" type="range" min="0" max="1" step="0.01" value="0.5" title="the amp's treble, which on a bass is mostly the strings rather than the notes" /></label>
            <label class="sq-bass__f"><span>low cut</span><input class="p-bshpf" type="range" min="0" max="1" step="0.01" value="0.15" title="high-pass filter, 28Hz to 150Hz" /></label>
            <span class="sq-bass__lbl">cab</span>
            <select class="p-bscab" title="the speaker cabinet. An 8x10 pushes air and rolls off early, a fifteen is all lows and no top, a DI is no cab at all">
              <option value="8x10" selected>8x10</option><option value="4x10">4x10</option>
              <option value="1x15">1x15</option><option value="2x12">2x12</option><option value="di">di (no cab)</option>
            </select>
            <label class="sq-bass__f"><span>mic</span><input class="p-bsmic" type="range" min="0" max="1" step="0.01" value="0.4" title="where the mic sits in front of the cab: off-axis and dark at the bottom, straight at the cone at the top" /></label>
          </div>
        </div>`;


// Subby's panel. Same arrangement as the two rig panels above — the tone
// dropdown ships empty and is filled at runtime from SUB_TONE_NAMES, and the
// ranges and defaults must match SUB_NUM_CTLS in public/js/subbass.js. The
// control classes are `p-sub*`, not `p-sb*`: that prefix is the silverbox's.
const SUB_PANEL = `
        <div class="sq-param-group sq-param-group--sub" hidden>
          <div class="sq-sub__row">
            <span class="sq-sub__lbl">tone</span>
            <select class="sq-sub__tone" title="load a patch: oscillator, pitch drop, drive and shaping"></select>
          </div>
          <div class="sq-sub__row">
            <span class="sq-sub__lbl">osc</span>
            <label class="sq-sub__f"><span>sub oct</span><input class="p-suboct" type="range" min="0" max="1" step="0.01" value="0" title="a sine an octave below the note, there to be felt rather than heard" /></label>
            <label class="sq-sub__f"><span>detune</span><input class="p-subdetune" type="range" min="0" max="1" step="0.01" value="0" title="how far apart the stacked oscillators sit, up to 25 cents. The spread narrows as the note falls. Needs a stack of more than one" /></label>
            <select class="p-substack" title="how many oscillators. The spread hangs either side of the note, so changing this never retunes the track">
              <option value="1" selected>1 osc</option><option value="2">2 osc</option><option value="3">3 osc</option>
            </select>
            <label class="sq-sub__f"><span>phase</span><input class="p-subphase" type="range" min="0" max="1" step="0.01" value="0" title="where in its cycle the oscillator starts each note. A sine started at zero spends 6ms at 40Hz climbing to its peak, so the note is soft, while one started at the peak hits at once" /></label>
            <label class="sq-sub__f"><span>drift</span><input class="p-subdrift" type="range" min="0" max="1" step="0.01" value="0.06" title="a slow random wander in the tuning, a few cents wide" /></label>
            <select class="p-subglidem" title="when the glide applies. Always slides into every note. Legato slides only into a note arriving while another still sounds. The glide TIME is the track's own glide control">
              <option value="always" selected>glide always</option><option value="legato">glide legato</option>
            </select>
          </div>
          <div class="sq-sub__row">
            <span class="sq-sub__lbl">env</span>
            <label class="sq-sub__f"><span>drop</span><input class="p-subdrop" type="range" min="0" max="1" step="0.01" value="0.15" title="how far above the note the pitch starts before falling onto it, up to 40 semitones. The fall is the attack transient" /></label>
            <label class="sq-sub__f"><span>drop time</span><input class="p-subdroptm" type="range" min="0" max="1" step="0.01" value="0.2" title="how long that fall takes, 4ms to half a second. Short is a click on the front of the note, long is an audible fall" /></label>
            <label class="sq-sub__f"><span>attack</span><input class="p-subatk" type="range" min="0" max="1" step="0.01" value="0.02" title="how fast the note comes in. Instant at the bottom, wound up it swells in with no transient at all" /></label>
            <label class="sq-sub__f"><span>release</span><input class="p-subrel" type="range" min="0" max="1" step="0.01" value="0.15" title="how fast the note stops when its step ends. It can only shorten the decay, never extend it. At the top the note keeps ringing as though the step were still held" /></label>
            <label class="sq-sub__f"><span>click</span><input class="p-subclick" type="range" min="0" max="1" step="0.01" value="0.2" title="a short band of noise on the attack: the beater. Often the only part of the note a small speaker reproduces" /></label>
          </div>
          <div class="sq-sub__row">
            <span class="sq-sub__lbl">harm</span>
            <select class="p-subsat" title="what makes the harmonics. Tube is an asymmetric soft clip, even and odd, octave-up strongest. Fold reflects instead of clipping, so it keeps making new harmonics as it is driven. Fuzz is a hard clip: odd harmonics, hollow and loud. Rect rectifies, doubling the frequency">
              <option value="tube" selected>tube</option><option value="fold">fold</option>
              <option value="fuzz">fuzz</option><option value="rect">rectify</option>
            </select>
            <label class="sq-sub__f"><span>xover</span><input class="p-subxover" type="range" min="0" max="1" step="0.01" value="0.3" title="where the harmonics start, 60Hz to about 800Hz. Nothing below this is ever distorted" /></label>
            <label class="sq-sub__f"><span>edge</span><input class="p-subedge" type="range" min="0" max="1" step="0.01" value="0.35" title="how asymmetric the shaping is. Symmetric gives odd harmonics, hollow and growling. Asymmetric gives even ones, an octave up" /></label>
          </div>
          <div class="sq-sub__row">
            <span class="sq-sub__lbl">reso</span>
            <label class="sq-sub__f"><span>reso</span><input class="p-subreso" type="range" min="0" max="1" step="0.01" value="0" title="a 3-pole diode ladder, 18dB/oct, with the resonance feedback through a diode pair. It sits above the split at the XOVER frequency, so only what is above the crossover reaches it. At zero the stage is bypassed" /></label>
            <label class="sq-sub__f"><span>cutoff</span><input class="p-subrcut" type="range" min="0" max="1" step="0.01" value="0.5" title="where the filter sits before the envelope moves it, 100Hz to 8kHz. No key tracking, so high notes come out duller than low ones" /></label>
            <label class="sq-sub__f"><span>env</span><input class="p-subrenv" type="range" min="0" max="1" step="0.01" value="0.55" title="how far the envelope throws the cutoff above the knob, up to about four octaves. Cutoff low and env high makes every note a swoop" /></label>
            <label class="sq-sub__f"><span>decay</span><input class="p-subrdec" type="range" min="0" max="1" step="0.01" value="0.35" title="how long that sweep takes to fall back, 200ms to 2.5s. No sustain, and it keeps decaying whether or not the step is held" /></label>
            <label class="sq-sub__f"><span>accent</span><input class="p-subracc" type="range" min="0" max="1" step="0.01" value="0.35" title="how much a hard-hit step kicks the filter. Velocity above 0.6 charges a network whose time constant tracks reso, so at high resonance consecutive accents stack and a run of them climbs. Unaccented steps hear nothing from this" /></label>
          </div>
          <div class="sq-sub__row">
            <span class="sq-sub__lbl">out</span>
            <label class="sq-sub__f"><span>low cut</span><input class="p-subhpf" type="range" min="0" max="1" step="0.01" value="0.1" title="high-pass filter, 16Hz to 70Hz" /></label>
            <label class="sq-sub__f"><span>glue</span><input class="p-subglue" type="range" min="0" max="1" step="0.01" value="0.35" title="the compressor, threshold and makeup on one control" /></label>
            <label class="sq-sub__f"><span>ceiling</span><input class="p-subceil" type="range" min="0" max="1" step="0.01" value="0.85" title="the limiter's ceiling. It stays linear until the signal is near it" /></label>
          </div>
        </div>`;

// The vox's panel: the voice (the glottis and its envelope), the vibrato and
// drift that make it a person, the choir, and what it sings. Same arrangement
// as the panels above: the voice dropdown ships empty and is filled at runtime
// from VOX_TONE_NAMES, and the ranges and defaults must match VOX_NUM_CTLS in
// engineData.js; the consonant and words option VALUES are the names in
// VOX_CONSONANTS / VOX_WORDS (test/vox.test.js holds them together). Classes
// are `p-sng*`: `p-v*` is the contagion's.
const VOX_PANEL = `
        <div class="sq-param-group sq-param-group--vox" hidden>
          <div class="sq-vox__row">
            <span class="sq-vox__lbl">voice</span>
            <select class="sq-vox__tone" title="load a voice: the glottis, the vibrato, the choir and what it sings"></select>
            <select class="p-sngmode" title="poly sings every note it is given. Mono is one singer: last note wins, and a note arriving while another sounds slides into it (the track's glide, or a short slur when that is zero)"><option value="poly" selected>poly</option><option value="mono">mono</option></select>
          </div>
          <div class="sq-vox__row">
            <span class="sq-vox__lbl">glottis</span>
            <label class="sq-vox__f"><span>attack</span><input class="p-sngatk" type="range" min="0" max="1" step="0.01" value="0.15" title="how long a note takes to swell in, 5ms to 2s" /></label>
            <label class="sq-vox__f"><span>bright</span><input class="p-sngbright" type="range" min="0" max="1" step="0.01" value="0.5" title="how hard the folds close: a soft, lax voice at the bottom, a pressed, brassy one at the top. Velocity pushes it too" /></label>
            <label class="sq-vox__f"><span>focus</span><input class="p-sngfocus" type="range" min="0" max="1" step="0.01" value="0.5" title="how sharp the formants are: wide and blurred at the bottom, narrow and ringing at the top" /></label>
            <label class="sq-vox__f"><span>growl</span><input class="p-snggrowl" type="range" min="0" max="1" step="0.01" value="0" title="every other period longer and quieter: a subharmonic an octave down, the rasp of a pushed or a chanting voice" /></label>
          </div>
          <div class="sq-vox__row">
            <span class="sq-vox__lbl">vibrato</span>
            <label class="sq-vox__f"><span>depth</span><input class="p-sngvib" type="range" min="0" max="1" step="0.01" value="0.3" title="vibrato depth, up to 80 cents either way" /></label>
            <label class="sq-vox__f"><span>rate</span><input class="p-sngvrate" type="range" min="0" max="1" step="0.01" value="0.45" title="vibrato rate, 3.5Hz to 8Hz. Each choir voice runs a little faster or slower" /></label>
            <label class="sq-vox__f"><span>delay</span><input class="p-sngvdelay" type="range" min="0" max="1" step="0.01" value="0.3" title="how long a note is held before the vibrato comes in, up to 1.5s, then it fades in" /></label>
            <label class="sq-vox__f"><span>drift</span><input class="p-sngdrift" type="range" min="0" max="1" step="0.01" value="0.25" title="a slow wander in pitch and level, and the scoop up into each note from just under it. At zero it sings like a machine" /></label>
          </div>
          <div class="sq-vox__row">
            <span class="sq-vox__lbl">choir</span>
            <label class="sq-vox__f"><span>voices</span><input class="p-sngvoices" type="range" min="1" max="8" step="1" value="1" title="how many voices sing each note, one to eight" /></label>
            <label class="sq-vox__f"><span>detune</span><input class="p-sngdetune" type="range" min="0" max="1" step="0.01" value="0.3" title="how far apart the choir's voices are tuned, up to 25 cents either way" /></label>
            <label class="sq-vox__f"><span>spread</span><input class="p-sngspread" type="range" min="0" max="1" step="0.01" value="0.5" title="how wide the choir stands across the stereo field" /></label>
          </div>
          <div class="sq-vox__row">
            <span class="sq-vox__lbl">sings</span>
            <input class="p-sngtext sq-vox__lyric" type="text" maxlength="400" spellcheck="false" autocomplete="off" placeholder="type a lyric: la di da" title="what to sing, one syllable a note, split by spaces or hyphens: a consonant and a vowel each (shu bi du wa). Anything after the vowel is not sung. While this has a syllable in it, it is sung instead of the phrase beside it" />
            <select class="p-sngwords" title="one syllable a note from a phrase, a chord on one step sharing one, starting over when the transport stops. Off sings the consonant and the vowel slider"><option value="off" selected>off</option><option value="doo wop">doo wop</option><option value="la la">la la</option><option value="ooh aah">ooh aah</option><option value="na na">na na</option><option value="shoo bee">shoo bee</option><option value="ba da">ba da</option><option value="mama">mama</option><option value="hey yeah">hey yeah</option><option value="hallelujah">hallelujah</option><option value="oh no">oh no</option></select>
            <select class="p-sngcons" title="the consonant every note starts with, when the words are off. It starts before the step so the vowel lands on it"><option value="none" selected>no consonant</option><option value="h">h-</option><option value="s">s-</option><option value="sh">sh-</option><option value="f">f-</option><option value="z">z-</option><option value="v">v-</option><option value="p">p-</option><option value="t">t-</option><option value="k">k-</option><option value="b">b-</option><option value="d">d-</option><option value="g">g-</option><option value="m">m-</option><option value="n">n-</option><option value="l">l-</option><option value="w">w-</option><option value="y">y-</option><option value="r">r-</option></select>
            <label class="sq-vox__f"><span>bite</span><input class="p-sngbite" type="range" min="0" max="1" step="0.01" value="0.6" title="how loud the consonants are: the hiss of an s, the click of a t, the breath of an h" /></label>
          </div>
        </div>`;

// The drone's panel, laid out like the Grone it is modelled on: the equation
// oscillator, the VCF, the LFO, the delay and the cloud, left to right on the
// hardware and top to bottom here. Same arrangement as the panels above — the
// patch dropdown ships empty and is filled at runtime from DRONE_TONE_NAMES,
// and the ranges and defaults must match DRONE_NUM_CTLS in engineData.js.
// The equation and LFO-shape option VALUES are the names in DRONE_EQUATIONS /
// DRONE_LFO_SHAPES. Classes are `p-drn*`: `p-d*` is the hexop's.
const DRONE_PANEL = `
        <div class="sq-param-group sq-param-group--drone" hidden>
          <div class="sq-drone__row">
            <span class="sq-drone__lbl">patch</span>
            <select class="sq-drone__tone" title="load a patch: equation, filter, LFO, delay and cloud"></select>
          </div>
          <div class="sq-drone__row">
            <span class="sq-drone__lbl">osc</span>
            <select class="p-drneq" title="which of the sixteen equations the oscillator runs. Each is a formula of a counter and the three numbers A0, A1 and A2 (the track sliders), and its low eight bits are the output"><option value="sierpinski">1 sierpinski</option><option value="or">2 or</option><option value="xor">3 xor</option><option value="fifths">4 fifths</option><option value="harmonics">5 harmonics</option><option value="smear">6 smear</option><option value="stairs">7 stairs</option><option value="octaves" selected>8 octaves</option><option value="sweep">9 sweep</option><option value="pulse bits">10 pulse bits</option><option value="gates">11 gates</option><option value="thirds">12 thirds</option><option value="arp">13 arp</option><option value="fold">14 fold</option><option value="split">15 split</option><option value="chaos">16 chaos</option></select>
            <label class="sq-drone__f"><span>rate</span><input class="p-drnrate" type="range" min="0" max="1" step="0.01" value="0.5" title="the sample rate the counter runs at, around the note: two octaves down at the bottom, two up at the top, the note itself in the middle" /></label>
            <label class="sq-drone__f"><span>osc</span><input class="p-drnosc" type="range" min="0" max="1" step="0.01" value="0.8" title="the oscillator's level into the filter" /></label>
            <label class="sq-drone__f"><span>noise</span><input class="p-drnnoise" type="range" min="0" max="1" step="0.01" value="0" title="white noise into the filter beside the oscillator, following the loudest held note" /></label>
            <label class="sq-drone__f"><span>attack</span><input class="p-drnatk" type="range" min="0" max="1" step="0.01" value="0.3" title="how long a note takes to swell in, 2ms to 12s" /></label>
            <label class="sq-drone__f"><span>release</span><input class="p-drnrel" type="range" min="0" max="1" step="0.01" value="0.5" title="how long a note takes to fade once it lets go, 10ms to 20s" /></label>
            <select class="p-drnhold" title="latch holds every note until a note arrives at a later step, ignoring the step's length, so one note a bar is a drone. Notes on the same step are a chord and are all held. With the track's glide up, a latched chord slides into the next. Gate plays each note for its step">
              <option value="latch" selected>latch</option><option value="gate">gate</option>
            </select>
          </div>
          <div class="sq-drone__row">
            <span class="sq-drone__lbl">vcf</span>
            <label class="sq-drone__f"><span>reso</span><input class="p-drnreso" type="range" min="0" max="1" step="0.01" value="0.35" title="resonance. The loop is clipped, so near the top the filter screams and then holds its own level instead of running away" /></label>
            <label class="sq-drone__f"><span>drive</span><input class="p-drndrive" type="range" min="0" max="1" step="0.01" value="0.2" title="how hard the oscillator and noise hit the filter" /></label>
            <label class="sq-drone__f"><span>lfo</span><input class="p-drnmod1" type="range" min="0" max="1" step="0.01" value="0.3" title="how far the LFO moves the cutoff, up to four octaves either way" /></label>
          </div>
          <div class="sq-drone__row">
            <span class="sq-drone__lbl">lfo</span>
            <select class="p-drnlshape" title="the LFO's shape. Sweep falls once a cycle. Random levels jumps to a new value each cycle, random slopes glides between them"><option value="up">ramp up</option><option value="down">ramp down</option><option value="square">square</option><option value="tri" selected>triangle</option><option value="sine">sine</option><option value="sweep">sweep</option><option value="random">random levels</option><option value="slopes">random slopes</option></select>
            <label class="sq-drone__f"><span>rate</span><input class="p-drnlrate" type="range" min="0" max="1" step="0.01" value="0.25" title="LFO rate, 0.02Hz to 20Hz. It free-runs: a drone has no downbeat to reset on" /></label>
            <label class="sq-drone__f"><span>to delay</span><input class="p-drnldly" type="range" min="0" max="1" step="0.01" value="0" title="how far the LFO moves the delay time, which bends the pitch of everything in the line" /></label>
          </div>
          <div class="sq-drone__row">
            <span class="sq-drone__lbl">delay</span>
            <label class="sq-drone__f"><span>time</span><input class="p-drndtime" type="range" min="0" max="1" step="0.01" value="0.45" title="delay time, 20ms to 1.5s. Moving it bends the pitch, as on tape" /></label>
            <label class="sq-drone__f"><span>fbk</span><input class="p-drndfbk" type="range" min="0" max="1" step="0.01" value="0.45" title="how much of the delay goes back into it" /></label>
            <label class="sq-drone__f"><span>mix</span><input class="p-drndmix" type="range" min="0" max="1" step="0.01" value="0.25" title="dry to wet" /></label>
            <select class="p-drndir" title="reverse plays each delay-time-long chunk backwards, with two heads crossfading so the seams never show">
              <option value="forward" selected>forward</option><option value="reverse">reverse</option>
            </select>
          </div>
          <div class="sq-drone__row">
            <span class="sq-drone__lbl">cloud</span>
            <label class="sq-drone__f"><span>position</span><input class="p-drncpos" type="range" min="0" max="1" step="0.01" value="0.3" title="where in the last four seconds the grains are read from: just now at the bottom, the start of the buffer at the top" /></label>
            <label class="sq-drone__f"><span>size</span><input class="p-drncsize" type="range" min="0" max="1" step="0.01" value="0.5" title="grain length, 20ms to 1s" /></label>
            <label class="sq-drone__f"><span>pitch</span><input class="p-drncpitch" type="range" min="0" max="1" step="0.01" value="0.5" title="grain pitch, two octaves either way. Three quarters is an octave up" /></label>
            <label class="sq-drone__f"><span>density</span><input class="p-drncdens" type="range" min="0" max="1" step="0.01" value="0.5" title="how many grains start a second, half a grain to sixty" /></label>
            <label class="sq-drone__f"><span>texture</span><input class="p-drnctex" type="range" min="0" max="1" step="0.01" value="0.5" title="grain shape: hard-edged and buzzing at the bottom, a triangle in the middle, soft and sparse at the top" /></label>
            <label class="sq-drone__f"><span>spread</span><input class="p-drncspread" type="range" min="0" max="1" step="0.01" value="0.5" title="how far the grains scatter across the stereo field and back through the buffer" /></label>
            <label class="sq-drone__f"><span>fbk</span><input class="p-drncfbk" type="range" min="0" max="1" step="0.01" value="0.3" title="how much of the cloud is recorded back into its own buffer" /></label>
            <label class="sq-drone__f"><span>blend</span><input class="p-drncmix" type="range" min="0" max="1" step="0.01" value="0.35" title="dry to cloud" /></label>
            <select class="p-drnfreeze" title="stop recording: the grains keep reading whatever is in the buffer, notes or no notes, for as long as this is on">
              <option value="off" selected>freeze off</option><option value="on">freeze on</option>
            </select>
          </div>
        </div>`;

export const STUDIO_BODY = String.raw`
<header class="sq-transport">
    <div class="sq-transport__main">
    <a class="sq-logo" href="/" title="seqbaby: the homepage">
      <img src="/favicon.svg" alt="" />
      <span>seqbaby</span>
    </a>
    <button id="play" class="sq-play">play</button>
    <button id="kbd-record" class="sq-btn--ghost sq-icon-btn" type="button" aria-pressed="false" aria-label="record notes and knob moves" title="record computer-keyboard notes into the active track, and knob moves into their automation lanes, while the transport plays"></button>
    <button id="kbd-capture" class="sq-btn--ghost sq-icon-btn" type="button" aria-label="capture keyboard notes" title="write the notes you just played into the active track, after the fact"></button>
    <div class="sq-field"><label for="bpm">bpm</label><input id="bpm" type="number" value="110" min="40" max="240" /></div>
    <div class="sq-field"><label for="swing">swing</label><input id="swing" type="range" min="0" max="0.5" step="0.01" value="0" /></div>
    <button id="macro-pads" class="sq-btn--ghost" type="button" title="havoc: xy pads, one gesture moving parameters across several tracks"><span class="sq-btn__label">havoc</span></button>
    <!-- The code drawer (codePanel.js): Strudel live coding, run into
         the song without stopping the transport. -->
    <button id="code-btn" class="sq-btn--ghost" type="button" aria-pressed="false" title="live code: write Strudel patterns, ctrl/⌘ enter runs them into the song"><span class="sq-btn__label">code</span></button>
    <button id="vim-toggle" class="sq-btn--ghost" type="button" aria-pressed="false" title="vim mode (\`): hjkl move, i insert, a play, v select, : commands">vim</button>
    <!-- The two views of the song, one at a time (arrangement.js keeps
         body[data-view]): the track list, and the arrangement view built
         into #arrangement at init. -->
    <span class="sq-tabs" role="tablist" aria-label="view">
      <button class="sq-tabs__tab sq-btn--ghost" type="button" role="tab" data-view="tracks" aria-selected="true" title="the tracks: steps, sounds, effects"><span class="sq-btn__label">tracks</span></button>
      <button class="sq-tabs__tab sq-btn--ghost" type="button" role="tab" data-view="arrangement" aria-selected="false" tabindex="-1" title="the arrangement: the song as sections laid out across bars, with a lane per track, which chain mode plays"><span class="sq-btn__label">arrangement</span> <span class="sq-tabs__n"></span></button>
    </span>
    <!-- Undo / redo. Wired and painted by history.js, which also owns the
         ctrl/cmd-Z keys; they ship disabled because at boot there is nothing
         behind them yet. -->
    <span class="sq-history">
      <button id="undo" class="sq-btn--ghost sq-icon-btn" data-label="undo" type="button" aria-label="undo" title="nothing to undo (ctrl/⌘ Z)" disabled></button>
      <button id="redo" class="sq-btn--ghost sq-icon-btn" data-label="redo" type="button" aria-label="redo" title="nothing to redo (ctrl/⌘ shift Z)" disabled></button>
    </span>
    <!-- Mobile only: the scale row and the chord cluster are hidden below 768px
         and this button hosts both in one modal (openChordMenu). Chord mode is
         not only a keyboard feature (a tapped step takes the chord too, see
         startNote), so a phone needs a way in. Its caption is the current
         setting (syncChordMenuBtn), so the transport says something with the
         modal shut. -->
    <button id="chord-menu-btn" class="sq-mobile-only sq-btn--ghost sq-icon-btn" data-label="scale" type="button" aria-pressed="false" aria-label="scale and chord settings" title="scale and chord: which notes a tapped step snaps to, and what chord it writes"></button>
    </div><!-- /sq-transport__main -->
    <div class="sq-transport__right">
      <button id="metronome" class="sq-btn--ghost sq-icon-btn" data-label="metro" aria-pressed="false" aria-label="metronome" title="metronome click on the downbeat"></button>
      <!-- Mobile only: opens the pattern bar as a modal (openPatternMenu). It
           lives here, beside the metronome, so on a phone it joins the undo /
           redo / scale / metronome group; the bar itself is hidden there. -->
      <button id="pattern-menu-btn" class="sq-mobile-only sq-btn--ghost sq-icon-btn" data-label="session" type="button" aria-label="session menu" title="open session menu"></button>
      <svg id="beat-indicator" class="sq-beat-indicator" viewBox="-22 -22 44 44" width="40" height="40" aria-hidden="true"></svg>
      <div class="sq-meter sq-meter--master" title="master output level"><div class="sq-meter__bar"></div></div>
    </div><!-- /sq-transport__right -->
    <!-- Keyboard-performance cluster: its own full-width line under the transport
         controls (see .sq-transport__kbd-row). -->
    <div class="sq-transport__kbd-row">
    <span id="kbd-icon" class="sq-kbd-icon" title="computer keyboard plays the active track. q w e r t y u i o p [ ] are the white keys, 2 3 5 6 7 9 0 = the black ones, z / x shift octave. With a scale on, the white keys play its degrees and the black keys go silent."></span>
    <div class="sq-scale__field">
      <label class="sq-scale__toggle" title="lock to a scale. The keyboard's white keys (q w e r t y u i o p [ ]) play its degrees and the black keys go silent"><input id="scale-on" type="checkbox" /> scale</label>
      <select id="scale-root"></select>
      <select id="scale-mode"></select>
      <button id="note-colors" class="sq-btn--ghost sq-icon-btn" aria-pressed="false" aria-label="note colors" title="toggle diatonic note coloring on the piano roll + step grid"></button>
    </div>
    <span id="kbd-octave" class="sq-kbd-oct" title="keyboard base octave. z / x shift it down and up">C4</span>
    <div id="kbd-chord" class="sq-kbd-chord">
      <span class="sq-kbd-chord__lbl">chord</span>
      <label class="sq-kbd-chord__f"><span class="sq-kbd-chord__sub">type</span><select id="kbd-chord-type" title="chord mode: play each key as a chord. Off is single notes">
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
      </select></label>
      <label class="sq-kbd-chord__f"><span class="sq-kbd-chord__sub">voicing</span><select id="kbd-chord-cpx" title="voicing / inversion">
        <option value="0">root</option>
        <option value="1">1st inv</option>
        <option value="2">2nd inv</option>
        <option value="3">3rd inv</option>
        <option value="4">drop-oct</option>
      </select></label>
      <span id="kbd-arp" class="sq-kbd-arp" hidden>
        <label class="sq-kbd-arp__toggle" title="arpeggiate chords played from the keyboard. The steps they land on are written as arps"><input id="kbd-arp-on" type="checkbox" /> arp</label>
        <span id="kbd-arp-opts" class="sq-kbd-arp__opts" hidden>
          <label class="sq-kbd-chord__f"><span class="sq-kbd-chord__sub">rate</span><select id="kbd-arp-rate" title="arp rate (beats per note)">
            <option value="1">1/4</option>
            <option value="0.5">1/8</option>
            <option value="0.333">1/8t</option>
            <option value="0.25" selected>1/16</option>
            <option value="0.167">1/16t</option>
            <option value="0.125">1/32</option>
          </select></label>
          <label class="sq-kbd-chord__f"><span class="sq-kbd-chord__sub">range</span><select id="kbd-arp-range" title="octaves spanned">
            <option value="1" selected>1 oct</option>
            <option value="2">2 oct</option>
            <option value="3">3 oct</option>
            <option value="4">4 oct</option>
          </select></label>
          <label class="sq-kbd-chord__f"><span class="sq-kbd-chord__sub">dir</span><select id="kbd-arp-dir" title="arp direction">
            <option value="up" selected>up</option>
            <option value="down">down</option>
            <option value="updown">up-down</option>
            <option value="random">random</option>
          </select></label>
        </span>
      </span>
    </div>
    <div id="status" class="sq-status sq-status--bar">click play to unlock audio</div>
    </div><!-- /sq-transport__kbd-row -->
  </header>

  <div class="sq-pattern-bar">
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
  <!-- The arrangement view (arrangement.js), shown in place of the track list
       when the transport's arrangement tab is picked. -->
  <section id="arrangement" class="sq-arrange" aria-label="arrangement"></section>


  <main id="tracks"></main>
  <div class="sq-add-track-row">
    <button id="add-track" class="sq-btn--ghost">+ add track</button>
    <button id="add-bus" class="sq-btn--ghost" title="add an fx bus: a track with no instrument that others are sent into, so one filter, one fx rack, one mod matrix and one set of automation lanes shape all of them">+ add fx bus</button>
  </div>

  <template id="track-template">
    <section class="sq-track">
      <div class="sq-track__head">
        <input class="sq-track__name" type="text" placeholder="track" />
        <select class="sq-track__engine"></select>
        <button class="sq-track__wav sq-icon-btn sq-btn--ghost" data-label="sample" type="button" aria-label="sample / wave editor" title="sample / wave editor" disabled></button>
        <button class="sq-track__save sq-icon-btn sq-btn--ghost" aria-label="save patch" title="save the current custom patch"></button>
        <button class="sq-track__load-patch sq-icon-btn sq-btn--ghost" aria-label="load patch" title="load a saved patch into this track"></button>
        <div class="sq-field"><label>len</label><input class="sq-track__len" type="number" min="1" max="128" value="16" /></div>
        <div class="sq-track__len-extend">
          <button class="track-len-plus1 sq-btn--ghost" type="button" title="add a bar to this track's pattern, duplicating what is there">+1</button>
          <button class="track-len-2x sq-btn--ghost" type="button" title="double this track's pattern length, duplicating what is there">x2</button>
          <button class="track-len-4x sq-btn--ghost" type="button" title="quadruple this track's pattern length, duplicating what is there">x4</button>
          <button class="track-len-half sq-btn--ghost" type="button" title="halve this track's pattern length, keeping the first half">/2</button>
          <button class="track-len-quarter sq-btn--ghost" type="button" title="quarter this track's pattern length, keeping the first quarter">/4</button>
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
        <div class="sq-field sq-track__out-field" hidden><label>out</label>
          <select class="sq-track__out" title="where this track's output goes. Send several tracks into one fx bus and its filter, effects, mod matrix and automation lanes act on all of them at once"><option value="master">master</option></select>
        </div>
        <span class="sq-track__bus-in" hidden></span>
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
        <div class="sq-param-group sq-param-group--ladder" hidden>
          <div class="sq-ladder__osc-row">
            <span class="sq-ladder__osc-lbl">osc1</span>
            <select class="p-osc1range" title="range / octave">
              <option value="-2">32'</option><option value="-1">16'</option><option value="0" selected>8'</option><option value="1">4'</option><option value="2">2'</option>
            </select>
            <select class="p-osc1wave" title="waveform">
              <option value="triangle">tri</option><option value="sawtooth" selected>saw</option><option value="square">sqr</option><option value="sine">sin</option>
            </select>
          </div>
          <div class="sq-ladder__osc-row">
            <span class="sq-ladder__osc-lbl">osc2</span>
            <label class="sq-ladder__freq"><span>freq</span><input class="p-osc2freq" type="range" min="-7" max="7" step="1" value="0" /></label>
            <select class="p-osc2range" title="range / octave">
              <option value="-2">32'</option><option value="-1">16'</option><option value="0" selected>8'</option><option value="1">4'</option><option value="2">2'</option>
            </select>
            <select class="p-osc2wave" title="waveform">
              <option value="triangle">tri</option><option value="sawtooth" selected>saw</option><option value="square">sqr</option><option value="sine">sin</option>
            </select>
          </div>
          <div class="sq-ladder__osc-row">
            <span class="sq-ladder__osc-lbl">osc3</span>
            <label class="sq-ladder__freq"><span>freq</span><input class="p-osc3freq" type="range" min="-7" max="7" step="1" value="0" /></label>
            <select class="p-osc3range" title="range / octave">
              <option value="-2">32'</option><option value="-1" selected>16'</option><option value="0">8'</option><option value="1">4'</option><option value="2">2'</option>
            </select>
            <select class="p-osc3wave" title="waveform">
              <option value="triangle" selected>tri</option><option value="sawtooth">saw</option><option value="square">sqr</option><option value="sine">sin</option>
            </select>
          </div>
          <div class="sq-field sq-ladder__noise">
            <label>noise</label><input class="p-noise" type="range" min="0" max="1" step="0.01" value="0" />
            <select class="p-noisetype" title="noise color">
              <option value="white" selected>white</option><option value="pink">pink</option>
            </select>
          </div>
        </div>
        <div class="sq-param-group sq-param-group--contagion" hidden>
          <div class="sq-contagion__row">
            <span class="sq-contagion__lbl">osc</span>
            <label class="sq-contagion__f"><span>semi</span><input class="p-vosc2semi" type="range" min="-24" max="24" step="1" value="0" title="osc 2 pitch offset in semitones" /></label>
            <label class="sq-contagion__f"><span>detune</span><input class="p-vosc2det" type="range" min="0" max="1" step="0.01" value="0.08" title="fine detune between the two oscillators" /></label>
            <label class="sq-contagion__f"><span>pw</span><input class="p-vpw" type="range" min="0.02" max="0.98" step="0.01" value="0.5" title="osc 1 pulse width. Only heard at the top of its shape morph, where the wave becomes a pulse" /></label>
            <label class="sq-contagion__f"><span>shape 2</span><input class="p-vshape2" type="range" min="0" max="1" step="0.01" value="0.5" title="osc 2's wave: sine, triangle, saw, then pulse. Osc 1's is the shape slider" /></label>
            <label class="sq-contagion__f"><span>pw 2</span><input class="p-vpw2" type="range" min="0.02" max="0.98" step="0.01" value="0.5" title="osc 2 pulse width. Only heard at the top of its shape morph" /></label>
            <label class="sq-contagion__f"><span>fm</span><input class="p-vfm" type="range" min="0" max="1" step="0.01" value="0" title="osc 1 frequency-modulates osc 2" /></label>
            <label class="sq-contagion__f"><span>ring</span><input class="p-vring" type="range" min="0" max="1" step="0.01" value="0" title="ring modulation: osc 1 times osc 2, for clangorous metallic tones" /></label>
            <select class="p-vsync" title="hard sync: osc 2 restarts every time osc 1 completes a cycle, so it is forced to osc 1's pitch">
              <option value="off" selected>sync off</option><option value="on">sync on</option>
            </select>
            <select class="p-vsubwave" title="sub oscillator waveform, one octave below osc 1 (its level is the sub slider)">
              <option value="square" selected>sub sqr</option><option value="triangle">sub tri</option>
            </select>
          </div>
          <div class="sq-contagion__row">
            <span class="sq-contagion__lbl">unison</span>
            <select class="p-vuni" title="how many detuned copies of the oscillator section each note plays">
              <option value="1" selected>1</option><option value="2">2</option><option value="3">3</option>
              <option value="4">4</option><option value="6">6</option><option value="8">8</option>
            </select>
            <label class="sq-contagion__f"><span>detune</span><input class="p-vunidet" type="range" min="0" max="1" step="0.01" value="0.3" title="how far the unison copies spread in pitch" /></label>
            <label class="sq-contagion__f"><span>spread</span><input class="p-vunispread" type="range" min="0" max="1" step="0.01" value="0.6" title="how far the unison copies spread across the stereo field" /></label>
          </div>
          <div class="sq-contagion__row">
            <span class="sq-contagion__lbl">amp env</span>
            <label class="sq-contagion__f"><span>atk</span><input class="p-vatk" type="range" min="0" max="1" step="0.01" value="0.02" /></label>
            <label class="sq-contagion__f"><span>sus</span><input class="p-vsus" type="range" min="0" max="1" step="0.01" value="0.6" /></label>
            <label class="sq-contagion__f"><span>slope</span><input class="p-vslope" type="range" min="-1" max="1" step="0.01" value="0" title="what the level does while the note is held: the middle holds it, right of the middle it falls away, left of it it climbs back up. Further from the middle is faster" /></label>
            <label class="sq-contagion__f"><span>rel</span><input class="p-vrel" type="range" min="0" max="1" step="0.01" value="0.25" /></label>
            <span class="sq-contagion__lbl">filter env</span>
            <label class="sq-contagion__f"><span>atk</span><input class="p-vfatk" type="range" min="0" max="1" step="0.01" value="0.02" title="how long the filter envelope takes to open" /></label>
            <label class="sq-contagion__f"><span>dec</span><input class="p-vfdec" type="range" min="0" max="1" step="0.01" value="0.4" title="how long the filter envelope takes to fall to its sustain. Short with a low sustain is a pluck" /></label>
            <label class="sq-contagion__f"><span>sus</span><input class="p-vfsus" type="range" min="0" max="1" step="0.01" value="0.6" title="where the filter envelope holds while the note is held" /></label>
            <label class="sq-contagion__f"><span>slope</span><input class="p-vfslope" type="range" min="-1" max="1" step="0.01" value="0" title="what the filter envelope does while held: the middle holds, right falls, left climbs" /></label>
            <label class="sq-contagion__f"><span>rel</span><input class="p-vfrel" type="range" min="0" max="1" step="0.01" value="0.25" title="how long the filter envelope takes to close once the note ends" /></label>
            <label class="sq-contagion__f"><span>env amt</span><input class="p-venvamt" type="range" min="-1" max="1" step="0.01" value="0.5" title="how much the filter envelope moves both cutoffs. Negative sweeps downward" /></label>
          </div>
          <div class="sq-contagion__row">
            <span class="sq-contagion__lbl">filter 1</span>
            <select class="p-vmode1" title="filter 1 response">
              <option value="lp" selected>lp</option><option value="hp">hp</option><option value="bp">bp</option><option value="bs">bs</option>
            </select>
            <select class="p-vpoles" title="filter 1 slope: 2-pole is 12dB per octave, 4-pole is 24">
              <option value="2">2-pole</option><option value="4" selected>4-pole</option>
            </select>
            <span class="sq-contagion__lbl">filter 2</span>
            <select class="p-vmode2" title="filter 2 response">
              <option value="lp" selected>lp</option><option value="hp">hp</option><option value="bp">bp</option><option value="bs">bs</option>
            </select>
            <label class="sq-contagion__f"><span>cut 2</span><input class="p-vcut2" type="range" min="-1" max="1" step="0.01" value="0" title="filter 2's cutoff, offset from filter 1 by up to two octaves either way" /></label>
            <label class="sq-contagion__f"><span>reso 2</span><input class="p-vreso2" type="range" min="0" max="1" step="0.01" value="0.5" title="filter 2's resonance. Filter 1's is the reso slider. The last tenth of either self-oscillates" /></label>
            <select class="p-vroute" title="how the two filters are wired: series (one into the other), parallel (both from the same source), or split (filter 1 left, filter 2 right)">
              <option value="ser" selected>series</option><option value="par">parallel</option><option value="split">split</option>
            </select>
            <label class="sq-contagion__f"><span>balance</span><input class="p-vbal" type="range" min="0" max="1" step="0.01" value="0" title="crossfade between the two filters' outputs" /></label>
            <span class="sq-contagion__lbl">sat</span>
            <select class="p-vsat" title="the saturation stage between the two filters. Filter 2 cleans up whatever it does to filter 1's output">
              <option value="off">off</option><option value="light">light</option><option value="soft" selected>soft</option>
              <option value="middle">middle</option><option value="hard">hard</option><option value="digital">digital</option>
              <option value="shaper">shaper</option><option value="rectify">rectify</option><option value="bits">bit reduce</option>
              <option value="rate">rate reduce</option><option value="ratefollow">rate + follow</option>
              <option value="lowpass">low pass</option><option value="lowfollow">low + follow</option>
              <option value="highpass">high pass</option><option value="highfollow">high + follow</option>
            </select>
            <label class="sq-contagion__f"><span>amt</span><input class="p-vsatamt" type="range" min="0" max="1" step="0.01" value="0.3" title="how hard the saturation works. On the filter curves it is the cutoff, on the follow curves relative to the note" /></label>
          </div>
        </div>
${HEXOP_PANEL}
${GUITAR_PANEL}
${BASS_PANEL}
${SUB_PANEL}
${DRONE_PANEL}
${VOX_PANEL}
        <div class="sq-param-group sq-param-group--silverbox" hidden>
          <div class="sq-field"><label>wave</label>
            <select class="p-sbwave" title="the two waveforms. Saw is brighter, square is hollower and sits lower">
              <option value="saw" selected>saw</option><option value="square">square</option>
            </select>
          </div>
          <div class="sq-field"><label>accent</label><input class="p-sbaccent" type="range" min="0" max="1" step="0.01" value="0.6" title="how hard an accented step hits. Accent makes the note louder, forces the filter decay to a fixed 200ms, and charges the accent circuit, so at high resonance consecutive accents pile up into a rising squelch" /></div>
          <div class="sq-field"><label>tune</label><input class="p-sbtune" type="range" min="-50" max="50" step="1" value="0" title="master tuning, in cents" /></div>
        </div>
        <div class="sq-param-group sq-param-group--granular" hidden>
          <div class="sq-gran__row">
            <label class="sq-gran__lbl">play</label>
            <select class="p-gplay" title="fixed = every grain reads from one spot; moving = the play head scans through the sample">
              <option value="fixed" selected>fixed</option><option value="moving">moving</option>
            </select>
            <div class="sq-field"><label>speed</label><input class="p-gspeed" type="range" min="-2" max="2" step="0.01" value="1" title="how fast the play head travels through the sample, when play is set to moving. 1 is the sample&#39;s own speed, 0 is frozen, negative runs backwards, up to 2x either way. Pitch is unaffected" /></div>
            <div class="sq-field"><label>pitch</label><input class="p-gpitch" type="range" min="-24" max="24" step="1" value="0" title="transposes every grain, in semitones, up or down two octaves. Independent of speed, so the sample still plays through in the same time" /></div>
            <label class="sq-gran__lbl">loop</label>
            <select class="p-gloop" title="what the moving play head does at the end of the sample: stop, wrap to the start, or bounce back">
              <option value="none">none</option><option value="fwd" selected>fwd</option><option value="bidir">bidir</option>
            </select>
          </div>
          <div class="sq-gran__row">
            <div class="sq-field"><label>window</label><input class="p-gwindow" type="range" min="0" max="1" step="0.01" value="0.15" title="how far each grain may stray from the play head: the band drawn across the waveform. Narrow reads one instant over and over. At 100% grains come from anywhere in the sample" /></div>
            <div class="sq-field"><label>jitter</label><input class="p-gjitter" type="range" min="0" max="1" step="0.01" value="0.1" title="randomises when each grain fires. At zero the train is perfectly regular and hums a tone at the grain rate. Raise it to break that into texture" /></div>
            <div class="sq-field"><label>detune</label><input class="p-gdetune" type="range" min="0" max="1" step="0.01" value="0" title="random pitch per grain, up to a semitone either way" /></div>
            <div class="sq-field"><label>pan</label><input class="p-gpan" type="range" min="0" max="1" step="0.01" value="0.3" title="random stereo placement per grain. Widens the cloud without changing its tone" /></div>
          </div>
          <div class="sq-gran__row">
            <label class="sq-gran__lbl">pattern</label>
            <select class="p-gpattern" title="sprinkles octave or fifth jumps across the grains">
              <option value="none" selected>none</option><option value="oct">octaves</option><option value="fifth">fifths</option>
            </select>
            <label class="sq-gran__sync" title="lock the grain rate to the tempo instead of the dense slider"><input class="p-gsync" type="checkbox" title="lock the grain rate to the tempo instead of the dense slider" /> sync</label>
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
        <button class="sq-track__plock sq-btn--ghost" aria-pressed="false" title="p-lock: give this track its own sound in THIS pattern. Normally one sound covers all 32 patterns, so moving the cutoff moves it everywhere. Locked, this pattern keeps its own params, filter, fx, eq, comp and mod settings while the unlocked ones go on sharing the track's. The button belongs to the pattern, so it changes as you move between them. Unlocking hands the sound back but keeps the snapshot, so locking again brings it straight in">p-lock</button>
        <button class="sq-track__clear sq-btn--ghost">clear</button>
        <button class="track-dice sq-icon-btn sq-btn--ghost" data-label="dice" type="button" aria-label="random pattern, drag up or down to set density" title="random pattern. Drag up and down to set the density"></button>
        <button class="track-euclid sq-icon-btn sq-btn--ghost" data-label="euclid" type="button" aria-pressed="false" aria-label="euclidean rhythm generator" title="euclidean rhythm: N hits spread as evenly as possible over the pattern"></button>
        <button class="track-chance sq-icon-btn sq-btn--ghost" data-label="chance" type="button" aria-pressed="false" aria-label="chance melody generator" title="chance: a part from probabilities. Note lengths, rests, ties, and how likely each of the twelve semitones is"></button>
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
      <div class="sq-track__aut-panel" hidden></div>
      <div class="sq-track__roll-panel" hidden></div>
      <div class="sq-track__euclid-panel" hidden>
        <div class="sq-euclid__title">euclidean rhythm</div>
        <div class="sq-euclid__viz">
          <svg class="sq-euclid__ring" viewBox="0 0 120 120" width="120" height="120" aria-hidden="true"></svg>
          <div class="sq-euclid__readout">
            <div class="sq-euclid__formula"></div>
            <div class="sq-euclid__bits"></div>
            <div class="sq-euclid__hint"></div>
          </div>
        </div>
        <div class="sq-euclid__strip" aria-hidden="true"></div>
        <div class="sq-euclid__ctls">
          <label class="sq-euclid__f" title="how many hits go in the cycle">
            <span>pulses</span>
            <input class="p-eucpulses" type="range" min="0" max="32" step="1" value="4" />
            <output class="sq-euclid__val sq-euclid__val--pulses"></output>
          </label>
          <label class="sq-euclid__f" title="how long the cycle is before it repeats across the track">
            <span>steps</span>
            <input class="p-eucsteps" type="range" min="1" max="32" step="1" value="16" />
            <output class="sq-euclid__val sq-euclid__val--steps"></output>
          </label>
          <label class="sq-euclid__f" title="turn the ring: the same rhythm, landing later">
            <span>rotate</span>
            <input class="p-eucrotate" type="range" min="0" max="31" step="1" value="0" />
            <output class="sq-euclid__val sq-euclid__val--rotate"></output>
          </label>
        </div>
        <div class="sq-euclid__opts">
          <label title="hold each hit until the next one instead of a one-step gate">gate <select class="sq-euclid__gate">
            <option value="short">short</option>
            <option value="legato">legato</option>
          </select></label>
          <label title="louder on the beat, quieter off it"><input class="sq-euclid__accent" type="checkbox" checked /> accent the beat</label>
        </div>
        <div class="sq-euclid__actions">
          <label class="sq-euclid__live" title="generate this track's rhythm live instead of playing the written steps. Nothing is written, so pulses, steps and rotate can take an LFO, an automation lane or a macro pad. Switch it off and the pattern is exactly as you left it. The step grid shows what is generated and goes read-only while this is on"><input class="sq-euclid__on" type="checkbox" /> live</label>
          <button class="sq-euclid__write sq-btn--ghost" type="button" title="print this rhythm into the pattern as ordinary steps, replacing what is there. Hits landing on an existing note keep its pitch">write to pattern</button>
        </div>
      </div>
      <div class="sq-track__chance-panel" hidden>
        <div class="sq-chance__head">
          <div class="sq-chance__title">chance: a part from probabilities</div>
          <div class="sq-chance__actions">
            <label class="sq-chance__live" title="generate this track's part live, rhythm and pitches both, instead of playing the written steps. Nothing is written, so note value, variation, legato, rest and the two range knobs can take an LFO, an automation lane or a macro pad. Switch it off and the pattern is exactly as you left it. The step grid shows what is generated and goes read-only. A track has one rhythm source, so this switches the euclid ring off"><input class="sq-chance__on" type="checkbox" /> live</label>
            <button class="sq-chance__write sq-btn--ghost" type="button" title="print this throw into the pattern as ordinary steps, pitches and all, replacing what is there">write to pattern</button>
          </div>
        </div>
        <div class="sq-chance__roll" aria-hidden="true"></div>
        <div class="sq-chance__readout">
          <div class="sq-chance__summary"></div>
          <div class="sq-chance__hint"></div>
        </div>

        <div class="sq-chance__sec">
          <span class="sq-chance__sec-t">rhythm</span>
          <span class="sq-chance__opts">
            <label title="let variation reach the triplet values (1/4T, 1/8T). The grid is sixteenths, so they play as a ratcheted step: three notes evenly across the space"><input class="sq-chance__trips" type="checkbox" /> triplets</label>
            <label title="let variation reach 1/32 notes: one step, struck twice"><input class="sq-chance__x32" type="checkbox" /> 1/32s</label>
          </span>
          <button class="sq-chance__dice-r sq-btn--ghost" type="button" title="throw the rhythm dice: new values for the note lengths, the rests and the ties. The throw is held, so the part repeats">roll</button>
          <label class="sq-chance__free" title="realtime: take a fresh throw every time the window comes round, so the rhythm never repeats"><input class="sq-chance__rfree" type="checkbox" /> realtime</label>
        </div>
        <div class="sq-chance__ctls">
          <label class="sq-chance__f" title="the base rhythm, 1/1 down to 1/32 including the triplets. This is the grid the rest of the section varies">
            <span>note value</span>
            <input class="p-chnnote" type="range" min="0" max="7" step="1" value="4" />
            <output class="sq-chance__val sq-chance__val--note"></output>
          </label>
          <label class="sq-chance__f" title="how often another note length turns up instead of the base one, and how far from it. Off in the middle, left for longer values, right for shorter">
            <span>variation</span>
            <input class="p-chnvar" type="range" min="-1" max="1" step="0.01" value="0" />
            <output class="sq-chance__val sq-chance__val--var"></output>
          </label>
          <label class="sq-chance__f" title="how likely a note is to tie to the one before instead of gating again. All the way up nothing re-gates and you get one held note">
            <span>legato</span>
            <input class="p-chnleg" type="range" min="0" max="1" step="0.01" value="0" />
            <output class="sq-chance__val sq-chance__val--leg"></output>
          </label>
          <label class="sq-chance__f" title="how likely a note is to be dropped for a rest. All the way up, silence">
            <span>rest</span>
            <input class="p-chnrest" type="range" min="0" max="1" step="0.01" value="0" />
            <output class="sq-chance__val sq-chance__val--rest"></output>
          </label>
        </div>

        <div class="sq-chance__sec">
          <span class="sq-chance__sec-t">melody</span>
          <span class="sq-chance__opts">
            <button class="sq-chance__scale sq-btn--ghost" type="button" title="set the twelve probabilities from the session's active scale, root loudest">from scale</button>
            <button class="sq-chance__clear-pcs sq-btn--ghost" type="button" title="put every semitone probability back to zero">none</button>
          </span>
          <button class="sq-chance__dice-m sq-btn--ghost" type="button" title="throw the melody dice: new pitches, same rhythm. Separate from the rhythm throw, so a part can repeat its rhythm while the notes keep moving">roll</button>
          <label class="sq-chance__free" title="realtime: a new melody every time the window comes round, so the pitches never repeat"><input class="sq-chance__mfree" type="checkbox" /> realtime</label>
        </div>
        <div class="sq-chance__keys">
          <label class="sq-chance__key" title="how likely C is to turn up. A probability, not a switch, so half height means half as often. One raised fader on its own is certain wherever it sits">
            <input class="sq-chance__pc" data-pc="0" type="range" min="0" max="1" step="0.01" value="1" aria-label="C probability" />
            <span>C</span>
          </label>
          <label class="sq-chance__key is-black" title="how likely C♯ is to turn up. A probability, not a switch, so half height means half as often. One raised fader on its own is certain wherever it sits">
            <input class="sq-chance__pc" data-pc="1" type="range" min="0" max="1" step="0.01" value="0" aria-label="C♯ probability" />
            <span>C♯</span>
          </label>
          <label class="sq-chance__key" title="how likely D is to turn up. A probability, not a switch, so half height means half as often. One raised fader on its own is certain wherever it sits">
            <input class="sq-chance__pc" data-pc="2" type="range" min="0" max="1" step="0.01" value="0" aria-label="D probability" />
            <span>D</span>
          </label>
          <label class="sq-chance__key is-black" title="how likely D♯ is to turn up. A probability, not a switch, so half height means half as often. One raised fader on its own is certain wherever it sits">
            <input class="sq-chance__pc" data-pc="3" type="range" min="0" max="1" step="0.01" value="0.7" aria-label="D♯ probability" />
            <span>D♯</span>
          </label>
          <label class="sq-chance__key" title="how likely E is to turn up. A probability, not a switch, so half height means half as often. One raised fader on its own is certain wherever it sits">
            <input class="sq-chance__pc" data-pc="4" type="range" min="0" max="1" step="0.01" value="0" aria-label="E probability" />
            <span>E</span>
          </label>
          <label class="sq-chance__key" title="how likely F is to turn up. A probability, not a switch, so half height means half as often. One raised fader on its own is certain wherever it sits">
            <input class="sq-chance__pc" data-pc="5" type="range" min="0" max="1" step="0.01" value="0.6" aria-label="F probability" />
            <span>F</span>
          </label>
          <label class="sq-chance__key is-black" title="how likely F♯ is to turn up. A probability, not a switch, so half height means half as often. One raised fader on its own is certain wherever it sits">
            <input class="sq-chance__pc" data-pc="6" type="range" min="0" max="1" step="0.01" value="0" aria-label="F♯ probability" />
            <span>F♯</span>
          </label>
          <label class="sq-chance__key" title="how likely G is to turn up. A probability, not a switch, so half height means half as often. One raised fader on its own is certain wherever it sits">
            <input class="sq-chance__pc" data-pc="7" type="range" min="0" max="1" step="0.01" value="0.9" aria-label="G probability" />
            <span>G</span>
          </label>
          <label class="sq-chance__key is-black" title="how likely G♯ is to turn up. A probability, not a switch, so half height means half as often. One raised fader on its own is certain wherever it sits">
            <input class="sq-chance__pc" data-pc="8" type="range" min="0" max="1" step="0.01" value="0" aria-label="G♯ probability" />
            <span>G♯</span>
          </label>
          <label class="sq-chance__key" title="how likely A is to turn up. A probability, not a switch, so half height means half as often. One raised fader on its own is certain wherever it sits">
            <input class="sq-chance__pc" data-pc="9" type="range" min="0" max="1" step="0.01" value="0" aria-label="A probability" />
            <span>A</span>
          </label>
          <label class="sq-chance__key is-black" title="how likely A♯ is to turn up. A probability, not a switch, so half height means half as often. One raised fader on its own is certain wherever it sits">
            <input class="sq-chance__pc" data-pc="10" type="range" min="0" max="1" step="0.01" value="0.5" aria-label="A♯ probability" />
            <span>A♯</span>
          </label>
          <label class="sq-chance__key" title="how likely B is to turn up. A probability, not a switch, so half height means half as often. One raised fader on its own is certain wherever it sits">
            <input class="sq-chance__pc" data-pc="11" type="range" min="0" max="1" step="0.01" value="0" aria-label="B probability" />
            <span>B</span>
          </label>
        </div>
        <div class="sq-chance__ctls">
          <div class="sq-chance__grp">
            <label class="sq-chance__f" title="the lowest note that can be played. A semitone outside the range cannot turn up, and its fader greys out to say so">
              <span>low note</span>
              <input class="p-chnlo" type="range" min="24" max="96" step="1" value="48" />
              <output class="sq-chance__val sq-chance__val--lo"></output>
            </label>
            <label class="sq-chance__f" title="the highest note that can be played. Five octaves above the low note at most">
              <span>high note</span>
              <input class="p-chnhi" type="range" min="24" max="96" step="1" value="72" />
              <output class="sq-chance__val sq-chance__val--hi"></output>
            </label>
          </div>
          <div class="sq-chance__grp sq-chance__grp--window">
            <span class="sq-chance__sec-t">window</span>
            <label class="sq-chance__f" title="where the generated window starts. Moving it slides the window without changing its length">
              <span>first step</span>
              <input class="p-chnfirst" type="range" min="0" max="31" step="1" value="0" />
              <output class="sq-chance__val sq-chance__val--first"></output>
            </label>
            <label class="sq-chance__f" title="where the generated window ends. The window tiles across the track, so a short one repeats within a long track">
              <span>last step</span>
              <input class="p-chnlast" type="range" min="0" max="31" step="1" value="15" />
              <output class="sq-chance__val sq-chance__val--last"></output>
            </label>
          </div>
        </div>
      </div>
      <!-- The panels shown inline on the track when something in them is on
           (is-live, paramTargets.js). One wrapper so they lay out as a grid
           of cards on desktop rather than one panel per line; the modals
           reparent each panel through an anchor at its own position, so the
           wrapper is invisible to them. -->
      <div class="sq-track__live">
      <div class="sq-track__filter-panel" hidden>
        <div class="sq-fx__row" data-fx="filter">
          <span class="sq-fx__title">filter (resonant)</span>
          <label class="sq-fx__ctl"><span>type</span><select class="p-filtertype" title="the filter's shape: lowpass keeps what's below the cutoff, highpass what's above it, bandpass a narrow band around it, notch everything but that band — plus eight analog-modeled characters further down the list">
            <option value="lowpass">lowpass</option>
            <option value="highpass">highpass</option>
            <option value="bandpass">bandpass</option>
            <option value="notch">notch</option>
          </select></label>
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
          <span class="sq-fx__title">eq (5-band)</span>
          <label class="sq-fx__ctl"><span>low</span><input class="p-eq-low" type="range" min="-18" max="18" step="0.5" value="0" /></label>
          <label class="sq-fx__ctl"><span>lo mid</span><input class="p-eq-lomid" type="range" min="-18" max="18" step="0.5" value="0" /></label>
          <label class="sq-fx__ctl"><span>mid</span><input class="p-eq-mid" type="range" min="-18" max="18" step="0.5" value="0" /></label>
          <label class="sq-fx__ctl"><span>hi mid</span><input class="p-eq-himid" type="range" min="-18" max="18" step="0.5" value="0" /></label>
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
          <label class="sq-fx__ctl" title="output level after the whole chain, to trim back what drive adds. Centre is unity, full is +6dB"><span>out</span><input class="fx-amp-level" type="range" min="0" max="1" step="0.01" value="0.5" /></label>
        </div>
        <div class="sq-fx__row" data-fx="gain">
          <span class="sq-fx__title">gain</span>
          <label class="sq-fx__ctl" title="a clean gain at this point in the chain: the stages after it are hit harder (fuzz, shaper, cassette sat, crush) or softer. Centre is unity, full is +18dB, left fades down"><span>drive</span><input class="fx-gain-drive" type="range" min="0" max="1" step="0.01" value="0.5" /></label>
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
          <label class="sq-fx__ctl" title="the sample rate the crusher runs at, 48k down to 250Hz. Anything above half of it folds back down out of tune"><span>rate</span><input class="fx-crush-rate" type="range" min="0" max="1" step="0.005" value="1" /></label>
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
        <div class="sq-fx__row" data-fx="repeat">
          <span class="sq-fx__title">beat repeat</span>
          <label class="sq-fx__ctl" title="how much of the repeat is in the signal: all the way is an insert (a repeat replaces the beat), less mixes it over"><span>mix</span><input class="fx-repeat-wet" type="range" min="0" max="1" step="0.01" value="0" /></label>
          <label class="sq-fx__ctl" title="repeat: capture a slice where it fires and repeat it (a beat repeat). slice: cut the track into slices as it plays and swap them for others from the window before (a live slicer)"><span>mode</span><select class="fx-repeat-mode">
            <option value="repeat" selected>repeat</option>
            <option value="slice">slice</option>
          </select></label>
          <label class="sq-fx__ctl" title="repeat: how often it fires on its step. slice: how often a slice is swapped. The same song makes the same choices every time"><span>chance</span><input class="fx-repeat-chance" type="range" min="0" max="1" step="0.01" value="0.5" /></label>
          <label class="sq-fx__ctl" title="repeat: how often a repeat may fire, 4 to 64 steps. slice: the window the swapped slices come from"><span>every</span><input class="fx-repeat-interval" type="range" min="0" max="1" step="0.01" value="0.5" /></label>
          <label class="sq-fx__ctl" title="where in the interval a repeat fires (repeat only)"><span>offset</span><input class="fx-repeat-offset" type="range" min="0" max="1" step="0.01" value="0.75" /></label>
          <label class="sq-fx__ctl" title="how long a repeat, or a swapped run of slices, holds, 1 to 32 steps"><span>gate</span><input class="fx-repeat-gate" type="range" min="0" max="1" step="0.01" value="0.33" /></label>
          <label class="sq-fx__ctl" title="the slice: what is captured and repeated, or what the track is cut into, 1/64 to a bar, triplets included"><span>grid</span><input class="fx-repeat-grid" type="range" min="0" max="1" step="0.01" value="0.33" /></label>
          <label class="sq-fx__ctl" title="repeat: how far each trigger's grid wanders from the knob. slice: how many swapped slices play backwards"><span>vary</span><input class="fx-repeat-vary" type="range" min="0" max="1" step="0.01" value="0" /></label>
          <label class="sq-fx__ctl" title="repeat: each repeat moves this far, 24 semitones down to 24 up, so a roll falls like a tape stopping or climbs. slice: swapped slices are transposed this far. The middle is no change"><span>pitch</span><input class="fx-repeat-pitch" type="range" min="0" max="1" step="0.01" value="0.5" /></label>
          <label class="sq-fx__ctl" title="repeat: each repeat this much quieter. slice: each swapped slice chopped this much shorter"><span>decay</span><input class="fx-repeat-decay" type="range" min="0" max="1" step="0.01" value="0" /></label>
        </div>
        <div class="sq-fx__row" data-fx="prism">
          <span class="sq-fx__title">prism</span>
          <label class="sq-fx__ctl" title="how much of the whole console is in the signal"><span>mix</span><input class="fx-prism-wet" type="range" min="0" max="1" step="0.01" value="0" /></label>
          <label class="sq-fx__ctl" title="character: drive (a mid-humped overdrive), sweeten (a little compression and air), fuzz (gated, the gate set by sens), howl (a resonant band fed back, following the playing), swell (every note fades in)"><span>char</span><select class="fx-prism-charmode">
            <option value="drive" selected>drive</option>
            <option value="sweeten">sweeten</option>
            <option value="fuzz">fuzz</option>
            <option value="howl">howl</option>
            <option value="swell">swell</option>
          </select></label>
          <label class="sq-fx__ctl" title="how much character: drive and fuzz gain, howl feedback, swell time. 0 takes the module out"><span>amt</span><input class="fx-prism-char" type="range" min="0" max="1" step="0.01" value="0.25" /></label>
          <label class="sq-fx__ctl" title="movement: doubler (a second player just behind), vibrato, phaser, tremolo (sine to square as it deepens), pitch (a harmony voice)"><span>move</span><select class="fx-prism-movemode">
            <option value="doubler" selected>doubler</option>
            <option value="vibrato">vibrato</option>
            <option value="phaser">phaser</option>
            <option value="tremolo">tremolo</option>
            <option value="pitch">pitch</option>
          </select></label>
          <label class="sq-fx__ctl" title="how much movement: its depth. On pitch, which interval: an octave down at the bottom through a fourth, a fifth, up to an octave up"><span>amt</span><input class="fx-prism-move" type="range" min="0" max="1" step="0.01" value="0.3" /></label>
          <label class="sq-fx__ctl" title="diffusion: cascade (ping-pong echoes that smear into a wash), reels (a tape echo), space (a reverb), collage (fragments of the last few seconds, some backwards), reverse (each slice played backwards)"><span>diff</span><select class="fx-prism-diffmode">
            <option value="cascade">cascade</option>
            <option value="reels">reels</option>
            <option value="space" selected>space</option>
            <option value="collage">collage</option>
            <option value="reverse">reverse</option>
          </select></label>
          <label class="sq-fx__ctl" title="how much diffusion: its level and its feedback together"><span>amt</span><input class="fx-prism-diff" type="range" min="0" max="1" step="0.01" value="0.35" /></label>
          <label class="sq-fx__ctl" title="texture: filter (a resonant lowpass the playing opens), squash (a compressor), cassette (wow, flutter, saturation, hiss), broken (dropouts, stutters, lost bits), interference (a radio band with static)"><span>tex</span><select class="fx-prism-texmode">
            <option value="filter">filter</option>
            <option value="squash">squash</option>
            <option value="cassette" selected>cassette</option>
            <option value="broken">broken</option>
            <option value="interference">interference</option>
          </select></label>
          <label class="sq-fx__ctl" title="how much texture. 0 takes the module out"><span>amt</span><input class="fx-prism-tex" type="range" min="0" max="1" step="0.01" value="0.25" /></label>
          <label class="sq-fx__ctl" title="a see-saw eq on the way out: left darker, right brighter, flat in the middle"><span>tilt</span><input class="fx-prism-tilt" type="range" min="0" max="1" step="0.01" value="0.5" /></label>
          <label class="sq-fx__ctl" title="the movement module's speed, 0.05 to 12Hz"><span>rate</span><input class="fx-prism-rate" type="range" min="0" max="1" step="0.01" value="0.35" /></label>
          <label class="sq-fx__ctl" title="the diffusion module's time: echo spacing on cascade and reels, the tail on space, grain size on collage, slice length on reverse"><span>time</span><input class="fx-prism-time" type="range" min="0" max="1" step="0.01" value="0.4" /></label>
          <label class="sq-fx__ctl" title="how readily the envelope-driven characters answer the playing: swell's trigger, the fuzz gate, howl, the texture filter"><span>sens</span><input class="fx-prism-sens" type="range" min="0" max="1" step="0.01" value="0.5" /></label>
          <label class="sq-fx__ctl" title="slow random wander across everything that moves: the rate, echo times, the harmony's tuning, the tape"><span>drift</span><input class="fx-prism-drift" type="range" min="0" max="1" step="0.01" value="0.2" /></label>
        </div>
        <div class="sq-fx__row" data-fx="pan">
          <span class="sq-fx__title">pan</span>
          <label class="sq-fx__ctl" title="where in the stereo field, at this point in the chain: left, centre, right. An LFO on it is an auto-pan"><span>pos</span><input class="fx-pan-pos" type="range" min="0" max="1" step="0.01" value="0.5" /></label>
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
      <div class="sq-track__mod-panel" hidden></div>
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
        <option value="randsq">rnd square</option>
        <option value="euclid">euclid</option>
      </select>
      <label class="sq-lfo__sync-wrap">
        <input type="checkbox" class="lfo-sync" />
        sync
      </label>
      <div class="sq-field sq-lfo__rate-field">
        <label class="sq-lfo__rate-name">length</label>
        <input class="sq-lfo__rate" type="range" min="0" max="1" step="0.001" value="0.35" title="free-running speed in hz, ignoring the tempo" />
        <input class="sq-lfo__div" type="range" min="0" max="7" step="1" value="3" title="how long one cycle is, counted in sequencer steps" />
        <span class="sq-lfo__rate-label">1.00 hz</span>
      </div>
      <div class="sq-field sq-lfo__amt-field">
        <label>amount</label>
        <input class="lfo-depth" type="range" min="0" max="1" step="0.01" value="0.5" />
        <span class="sq-lfo__depth-line">
          <span class="sq-lfo__depth-label">0.50</span>
          <label class="sq-lfo__bip" title="bipolar: the modulation swings either side of where the knob sits. Switch it off and it only lifts the parameter above the knob, never below, with the same peak-to-peak either way. Waveforms start bipolar, a euclid ring unipolar">
            <input type="checkbox" class="lfo-bip" />
            <span aria-hidden="true">±</span>
          </label>
        </span>
      </div>
      <div class="sq-field sq-lfo__phase-field">
        <label>phase</label>
        <input class="lfo-phase" type="range" min="0" max="1" step="0.005" value="0" title="where in its cycle the shape starts. A quarter turn between two lfos at the same rate is a circular pan, half a turn is the same sweep inverted. On the euclid ring the cycle is one step, so this nudges taps off the grid where rotate moves whole steps" />
        <span class="sq-lfo__phase-label">0°</span>
      </div>
      <button class="sq-lfo__remove sq-btn--ghost" type="button" title="remove this modulation">×</button>
      <div class="sq-lfo__euc" hidden>
        <span class="sq-lfo__euc-bits" aria-hidden="true"></span>
        <label class="sq-lfo__euc-f" title="how many taps go in the cycle">
          <span>pulses</span>
          <input class="sq-lfo__euc-pulses" type="range" min="0" max="32" step="1" value="4" />
          <output class="sq-lfo__euc-val"></output>
        </label>
        <label class="sq-lfo__euc-f" title="how many steps the cycle is before it repeats. The rate above is the step rate, so 1/16 with 8 steps is a half-bar cycle">
          <span>steps</span>
          <input class="sq-lfo__euc-steps" type="range" min="1" max="32" step="1" value="8" />
          <output class="sq-lfo__euc-val"></output>
        </label>
        <label class="sq-lfo__euc-f" title="turn the ring: the same rhythm, landing later">
          <span>rotate</span>
          <input class="sq-lfo__euc-rotate" type="range" min="0" max="31" step="1" value="0" />
          <output class="sq-lfo__euc-val"></output>
        </label>
        <label class="sq-lfo__euc-f" title="0 holds each tap for its whole step, which is a gate. Turn it up and the tap falls away instead, a pluck">
          <span>decay</span>
          <input class="sq-lfo__euc-decay" type="range" min="0" max="1" step="0.01" value="0.4" />
          <output class="sq-lfo__euc-val"></output>
        </label>
      </div>
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
