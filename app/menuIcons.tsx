// The little icons on the songs menu's rows and the version tree's. A template
// row carries six actions and the panel is 300px wide, so as text ("dflt",
// "tmpl", "hist", ...) they left the song's own title one letter and an
// ellipsis. Each is 16x16 on currentColor, so the button's colour states
// (`iconBtn` / `iconBtnOn`) carry through unchanged; the button keeps its
// `title` and gains an `aria-label`, since the text that used to name it is
// gone.

type IconProps = { on?: boolean };

const base = {
  viewBox: "0 0 16 16",
  width: 14,
  height: 14,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

/** Default template: the one a new song starts from. A star, filled when on. */
export function IconDefault({ on }: IconProps) {
  return (
    <svg {...base} fill={on ? "currentColor" : "none"}>
      <path d="M8 1.9l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.7l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
    </svg>
  );
}

/** Template: a stencil, drawn dashed, with the copy it makes inside. */
export function IconTemplate({ on }: IconProps) {
  return (
    <svg {...base}>
      <rect
        x="2.2"
        y="2.2"
        width="11.6"
        height="11.6"
        rx="1.8"
        strokeDasharray="2.4 1.7"
      />
      <rect
        x="5.4"
        y="5.4"
        width="5.2"
        height="5.2"
        rx="0.8"
        fill={on ? "currentColor" : "none"}
      />
    </svg>
  );
}

/** Version history: a clock. */
export function IconHistory() {
  return (
    <svg {...base}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.6V8l2.4 1.6" />
    </svg>
  );
}

/** Fork: one line of history becoming two. */
export function IconFork() {
  return (
    <svg {...base}>
      <circle cx="4" cy="3.5" r="1.4" />
      <circle cx="12" cy="3.5" r="1.4" />
      <circle cx="8" cy="12.5" r="1.4" />
      <path d="M4 4.9v1.3a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V4.9M8 8.2v2.9" />
    </svg>
  );
}

/** Public link. */
export function IconLink() {
  return (
    <svg {...base}>
      <path d="M6.8 9.2a3 3 0 0 0 4.2 0l1.8-1.8a3 3 0 0 0-4.2-4.2l-.9.9" />
      <path d="M9.2 6.8a3 3 0 0 0-4.2 0L3.2 8.6a3 3 0 0 0 4.2 4.2l.9-.9" />
    </svg>
  );
}

/** Delete. */
export function IconTrash() {
  return (
    <svg {...base}>
      <path d="M2.8 4.3h10.4M6.2 4.3V2.8h3.6v1.5M4.3 4.3l.6 8.9h6.2l.6-8.9" />
      <path d="M6.7 7v4M9.3 7v4" />
    </svg>
  );
}

/** Name a version: a tag. */
export function IconTag() {
  return (
    <svg {...base}>
      <path d="M2.5 8.2V2.5h5.7l5.3 5.3-5.7 5.7z" />
      <circle cx="5.4" cy="5.4" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** The mobile top-bar menu: three bars, an X once it is open. */
export function IconMenu({ on }: IconProps) {
  return on ? (
    <svg {...base}>
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
    </svg>
  ) : (
    <svg {...base}>
      <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
    </svg>
  );
}
