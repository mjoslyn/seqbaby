// The engine's integration API, installed on window by public/js/appApi.js.
export {};

declare global {
  /** Where a bridge is written and how it plays (bridgeLayout, public/js/transitionPlan.js). */
  type BridgeLayout = {
    segs: { slot: number; bars: number; from: { slot: number; bar: number }[] }[];
    bars: number;
    barLen: number;
    land: number;
    oldSlot: number;
    intro: { sections: { slot: number; bars: number }[]; bars: number; land: number; barLen: number; leadIn: boolean };
  };
  /** One saved patch in the list the engine is handed (app/patches/bay.ts). */
  type PatchListEntry = { name: string; engineKey: string | null; kind: string | null; config?: unknown };
  /** How the engine reaches the account's patch bay. */
  type PatchBackend = {
    fetch: (name: string) => Promise<unknown>;
    save: (name: string, config: unknown) => Promise<void>;
    remove: (name: string) => Promise<void>;
  };

  interface Window {
    seqbaby?: {
      version: number;
      serializeSet: () => unknown;
      /** Start / stop the transport (idempotent, unlike the play button). */
      play: () => Promise<void>;
      stop: () => Promise<void>;
      /** Prime a suspended AudioContext; call inside a user gesture. */
      unlock: () => void;
      /** Launch pattern `slot` on track `i` alone, now (clips.js). */
      launchClip: (i: number, slot: number) => boolean;
      /** Stop track `i`'s clip: it plays nothing until one is launched. */
      stopClip: (i: number) => void;
      /** The open song's name as the top bar shows it, for the bounce
       *  dialog's file name. null: no song is open. */
      setSongName: (name: string | null) => void;
      applySet: (data: unknown) => {
        version: number;
        warnings: string[];
      } | void;
      /**
       * The same session, written onto the engine WITHOUT stopping it
       * (public/js/liveSet.js): tracks that changed change, tracks that
       * appeared join on the step everyone else is on, and everything already
       * playing goes on playing. `applySet` is how a song ARRIVES, and it
       * tears the session down to do it — right for opening one, fatal for
       * auditioning a change to the one you are listening to.
       *
       * Deliberately does not take `activePattern` from the blob: which
       * pattern you are looking at is the view, not the song.
       */
      mergeSet: (data: unknown) => {
        version: number;
        warnings: string[];
        added: number;
        removed: number;
        rebuilt: number;
      } | null;
      /**
       * mergeSet on a bar line (public/js/transition.js), shaped: `cut`,
       * `sweep` (a master lowpass), `drop` (the old song thins by group),
       * `fade` (the level dips), `stagger` (the new song arrives by group)
       * or `bridge` (a written passage standing in for the new song's intro,
       * the old song playing an outro over it). `tempo` auto ramps a
       * small bpm difference and jumps a large one. Stopped, it lands at
       * once. Resolves `landed: false` when cancelled first.
       */
      transitionTo?: (
        data: unknown,
        opts?: {
          when?: "bar" | "now";
          shape?: "cut" | "sweep" | "drop" | "fade" | "stagger" | "bridge";
          bars?: number;
          tempo?: "auto" | "jump" | "ramp";
          /** The new song's pattern to land on (for a bridge, where its intro starts). */
          into?: number;
          /** A written bridge and the layout it was written for; without one a bridge is drafted in code. */
          bridge?: { session: unknown; layout: BridgeLayout };
        },
      ) => Promise<{ landed: boolean }>;
      /** Drop a pending transition without landing it. */
      cancelTransition?: () => boolean;
      /** Land a pending transition now. */
      finishTransition?: () => boolean;
      transitionPending?: () => boolean;
      /** The bridge between the song playing and another (public/js/transitionPlan.js). */
      bridge?: {
        layout: (oldS: unknown, newS: unknown, opts?: { start?: number }) => BridgeLayout | null;
        draft: (oldS: unknown, newS: unknown, layout: BridgeLayout) => unknown;
        prompt: (oldS: unknown, newS: unknown, layout: BridgeLayout) => string;
        session: (draft: unknown, result: unknown, layout: BridgeLayout) => unknown;
        hasNotes: (session: unknown, layout: BridgeLayout) => boolean;
        same: (a: BridgeLayout | null, b: BridgeLayout | null) => boolean;
        /** Hand a pending bridge its written version. False when none is pending for that layout. */
        set: (session: unknown, layout: BridgeLayout) => boolean;
      };
      /** Format version of the blob serializeSet() writes (not `version`). */
      setVersion: number;
      validateSet: (data: unknown) => {
        ok: boolean;
        version: number;
        errors: string[];
        warnings: string[];
      };
      /** Blank the session (starter tracks, nothing written). No prompt. */
      newSet: () => void;
      /** The flow around newSet: asks first when there is work to lose. */
      onNewSet: () => Promise<void>;
      onSaveSet: () => void;
      onLoadSet: () => void;
      /** `title`: the currently open song's name, when there is one -- so the
       *  share doesn't get a freshly generated title instead of its own. */
      onShareSet: (title?: string) => void;
      onExportSet: () => void;
      onImportSet: () => void;
      /** Step the session's undo history (public/js/history.js). Both return
       *  whether there was anything to step to. */
      undo: () => boolean;
      redo: () => boolean;
      canUndo: () => boolean;
      canRedo: () => boolean;
      /** Has the song changed since it was last saved, shared, exported or
       *  opened? (history.js; an edit undone back counts as none.) */
      hasUnsavedChanges: () => boolean;
      /** The same, and there are notes in it: what the prompts ask about. */
      hasUnsavedWork: () => boolean;
      /** The session is saved somewhere now. Pass the blob that was written
       *  (what serializeSet returned when the save began), so an edit made
       *  while the save was in flight still counts as unsaved. */
      markSaved: (data?: unknown) => void;
      /** Ask before replacing the session, when there is unsaved work in it.
       *  Resolves true when it may go ahead. */
      confirmDiscard: (opts?: { title?: string; body?: string; confirmLabel?: string }) => Promise<boolean>;
      /** Saved patches live in the account (catalog.js); the shell hands the
       *  engine its way there and the list (app/PatchBay.tsx). */
      setPatchBackend: (backend: PatchBackend, list: PatchListEntry[]) => void;
      setPatchList: (list: PatchListEntry[]) => void;
      /**
       * The mix (public/js/mix.js): other songs on decks beside the open
       * one, as many as are loaded (ids "b", "c" ...). A call that names no
       * deck means the tempo's deck. The shell hands the engine its way to the account's songs
       * (app/MixSongs.tsx); null takes it away again.
       */
      setMixSource?: (
        backend: {
          list: () => Promise<Array<{ id: string; title: string; note?: string }>>;
          load: (id: string) => Promise<{ session: unknown; title?: string; versionId?: string | null; owned?: boolean }>;
        } | null,
      ) => void;
      mix?: {
        /** Loads onto a NEW deck (`replace`: a deck id to take off first). */
        load: (session: unknown, info?: { title?: string; source?: unknown; replace?: string }) => Promise<boolean>;
        eject: (opts?: { quiet?: boolean; id?: string }) => boolean;
        /** Eject deck A: deck B becomes the song and every other deck moves back a letter. */
        ejectA?: () => Promise<boolean>;
        playA?: (on: boolean, opts?: { when?: "now" | "pattern" }) => void;
        ejectClipSong?: () => Promise<boolean>;
        land: (id?: string) => Promise<boolean>;
        keepBoth: () => boolean;
        play: (on: boolean, id?: string) => void;
        scene: (slot: number, id?: string) => void;
        xfade: (x: number) => void;
        xfadeOn?: (on: boolean) => void;
        fadeTo: (deck: string, bars: number, opts?: { now?: boolean; at?: number | "playing" | "bar" | "pattern" | null; bar?: number; ref?: string }) => void;
        loadA?: (session: unknown, info?: { title?: string; source?: unknown }) => Promise<boolean>;
        tempo: (x: number) => void;
        /** Set a deck's tempo to the one playing. */
        matchTempo?: (id?: string) => boolean;
        /** Take one track (by its index in state.tracks) off its deck. */
        ejectTrack?: (index: number) => boolean;
        /** Put a deck on the crossfader, or take it off. */
        deckXfade?: (side: boolean | "l" | "r" | null, id?: string) => void;
        /** Which deck's tempo the tempo slider runs to. */
        tempoDeck?: (id: string) => void;
        /** Whether another song is loaded on a deck (and finished loading). */
        loaded?: () => boolean;
        decks?: () => Array<{ id: string; title: string; bpm: number; on: boolean; scene: number; loading: boolean }>;
        /** A deck's song in the session format, or null with none loaded. */
        serialize?: (id?: string) => unknown;
        /** A session written onto a deck in place; no other deck is touched. */
        merge?: (session: unknown, id?: string) => unknown;
      };
      serializeTrackPatch: (track: unknown) => unknown;
      applyTrackPatch: (track: unknown, patch: unknown) => void;
      /**
       * A jam: several studios holding one song (public/js/jam.js). The shell
       * runs the room and hands the engine `send`; the engine watches for
       * edits, diffs them against what the room last agreed on, and lays a
       * peer's patch over this copy without stopping the transport.
       */
      jam: {
        /** Start telling `send` about edits; the session as it is now is the
         *  base. `leave`, if given, is called instead of a broadcast when a
         *  different song arrives locally (opened from the menu, `new`). */
        start: (room: {
          send: (msg: { type: "patch"; patch: unknown } | { type: "playhead"; originMs: number; bpm: number }) => void;
          leave?: () => void;
        }) => void;
        stop: () => void;
        active: () => boolean;
        /** Send whatever is waiting to settle, now. */
        flush: () => void;
        /** The whole session, for a newcomer. */
        state: () => unknown;
        /** A peer's patch. `ok: false` means this copy is not the one it was
         *  written against: ask the sender for the whole session. */
        receivePatch: (patch: unknown, who?: { name?: string; id?: string }) => { ok: boolean; reason?: string };
        /** The room's whole session, on joining or after a refused patch. */
        receiveState: (session: unknown, who?: { name?: string; id?: string }) => { ok: boolean; reason?: string };
        /**
         * The play button's own action while in a jam: play/stop stay this
         * screen's own decision, but a start lands on the step the room's
         * beat is on rather than always on step 0.
         */
        togglePlay: () => void;
        /** A peer pressed play and is saying where the beat is. */
        receivePhase: (originMs: number, bpm: number) => void;
      };
      state: unknown;
    };
    // Set by EngineScripts' inline marker, which only executes when the studio
    // HTML is parsed from the document (i.e. not on a client-side navigation).
    // ScriptLoader reads it to decide whether to run its fallback boot.
    __seqbabyServerBoot?: number;
    // How many whole sessions applySet has loaded since boot (session.js).
    // SongByline reads it to tell the linked song from whatever came after.
    __seqbabySetsApplied?: number;
  }
}
