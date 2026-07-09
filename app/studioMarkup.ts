// AUTO-PORTED from the original public/index.html <body> (scripts stripped).
// This is the exact static DOM skeleton the vanilla engine (public/js/main.js)
// queries by id/class at boot. Rendered server-side via dangerouslySetInnerHTML;
// the three engine <script>s are injected client-side by ScriptLoader in order.
export const STUDIO_BODY = String.raw`
<header class="sq-transport">
    <div class="sq-logo" title="seqbaby">
      <img src="/favicon.svg" alt="" />
      <span>seqbaby</span>
    </div>
    <button id="play" class="sq-play">play</button>
    <div class="sq-field"><label for="bpm">bpm</label><input id="bpm" type="number" value="110" min="40" max="240" /></div>
    <div class="sq-field"><label for="swing">swing</label><input id="swing" type="range" min="0" max="0.5" step="0.01" value="0" /></div>
    <div class="sq-scale__field">
      <label class="sq-scale__toggle"><input id="scale-on" type="checkbox" /> scale</label>
      <select id="scale-root"></select>
      <select id="scale-mode"></select>
      <button id="note-colors" class="sq-btn--ghost sq-icon-btn" aria-pressed="false" aria-label="note colors" title="toggle diatonic note coloring on the piano roll + step grid"></button>
    </div>
    <button id="add-track" class="sq-btn--ghost">add track</button>
    <button id="kbd-notes" class="sq-btn--ghost" aria-pressed="false" title="play the active track from your computer keyboard (a s d f… = white keys, w e t y u = black, z/x = octave)">kbd</button>
    <div class="sq-spacer"></div>
    <button id="metronome" class="sq-btn--ghost sq-icon-btn" aria-pressed="false" aria-label="metronome" title="metronome click on the downbeat"></button>
    <svg id="beat-indicator" class="sq-beat-indicator" viewBox="-22 -22 44 44" width="40" height="40" aria-hidden="true"></svg>
    <div class="sq-meter sq-meter--master" title="master output level"><div class="sq-meter__bar"></div></div>
    <div id="status" class="sq-status">click play to unlock audio</div>
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

  <template id="track-template">
    <section class="sq-track">
      <div class="sq-track__head">
        <input class="sq-track__name" type="text" placeholder="track" />
        <select class="sq-track__engine"></select>
        <button class="sq-track__wav sq-icon-btn sq-btn--ghost" type="button" aria-label="sample / wave editor" title="sample / wave editor" hidden></button>
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
        <div class="sq-param-group sq-param-group--granular" hidden>
          <div class="sq-gran__row">
            <label class="sq-gran__lbl">play</label>
            <select class="p-gplay" title="playhead mode">
              <option value="fixed" selected>fixed</option><option value="moving">moving</option>
            </select>
            <div class="sq-field"><label>speed</label><input class="p-gspeed" type="range" min="0" max="1" step="0.01" value="0.5" title="playhead speed (0.5 = 100%)" /></div>
            <label class="sq-gran__lbl">loop</label>
            <select class="p-gloop" title="loop mode when moving">
              <option value="none">none</option><option value="fwd" selected>fwd</option><option value="bidir">bidir</option>
            </select>
          </div>
          <div class="sq-gran__row">
            <div class="sq-field"><label>window</label><input class="p-gwindow" type="range" min="0" max="1" step="0.01" value="0.15" title="position spread around the play head" /></div>
            <div class="sq-field"><label>jitter</label><input class="p-gjitter" type="range" min="0" max="1" step="0.01" value="0.1" title="grain timing randomness" /></div>
            <div class="sq-field"><label>detune</label><input class="p-gdetune" type="range" min="0" max="1" step="0.01" value="0" title="per-grain random pitch (0-1 semitone)" /></div>
            <div class="sq-field"><label>pan</label><input class="p-gpan" type="range" min="0" max="1" step="0.01" value="0.3" title="random stereo width per grain" /></div>
          </div>
          <div class="sq-gran__row">
            <label class="sq-gran__lbl">pattern</label>
            <select class="p-gpattern" title="add octave / fifth pitch variation per grain">
              <option value="none" selected>none</option><option value="oct">octaves</option><option value="fifth">fifths</option>
            </select>
            <label class="sq-gran__sync"><input class="p-gsync" type="checkbox" /> sync</label>
            <label class="sq-gran__lbl">rate</label>
            <select class="p-grate" title="grain rate when sync is on">
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
        <button class="track-note-mode sq-btn--ghost" aria-pressed="true" title="gate plays the full step length; trigger fires a short hit">gate</button>
        <button class="sq-track__clear sq-btn--ghost">clear</button>
        <button class="track-dice sq-icon-btn sq-btn--ghost" type="button" aria-label="random melody" title="random melody (replaces this pattern)"></button>
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
