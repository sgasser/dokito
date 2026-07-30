interface IconProps {
  size?: number;
}

/**
 * The handful of marks the workspace draws. Each is decorative — the control
 * around it carries the label — so they are hidden from assistive tech here
 * rather than at every call site.
 */
function Icon({
  children,
  size,
  viewBox,
}: IconProps & { children: React.ReactNode; viewBox: string }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox={viewBox}
      width={size}
    >
      {children}
    </svg>
  );
}

export function SearchIcon({ size = 14 }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 14 14">
      <circle
        cx="6.25"
        cy="6.25"
        r="4"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M9.25 9.25 12 12"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.3"
      />
    </Icon>
  );
}

export function BackIcon({ size = 13 }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 14 14">
      <path
        d="M8.5 3 4.5 7l4 4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </Icon>
  );
}

export function CloseIcon({ size = 12 }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 12 12">
      <path
        d="M3 3l6 6M9 3l-6 6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.3"
      />
    </Icon>
  );
}

export function ChevronIcon({ size = 10 }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 12 12">
      <path
        d="M3.5 4.5 6 7l2.5-2.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </Icon>
  );
}

export function CheckIcon({ size = 12 }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 12 12">
      <path
        d="M2.5 6.2 4.8 8.5 9.5 3.8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </Icon>
  );
}

/** A target: what needs the reader now, rather than where a thing is filed. */
export function FocusIcon({ size = 15 }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="8" cy="8" r="1.75" fill="currentColor" />
    </Icon>
  );
}

export function ResourcesIcon({ size = 15 }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 16 16">
      <path
        d="M4 2.5h5l3 3v8H4v-11Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.25"
      />
      <path
        d="M9 2.5v3h3M6 8.5h4M6 11h3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.25"
      />
    </Icon>
  );
}

export function ProjectsIcon({ size = 15 }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 16 16">
      <rect
        height="9"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.25"
        width="11"
        x="2.5"
        y="3.5"
      />
      <path d="M2.5 6.5h11M6 3.5v9" stroke="currentColor" strokeWidth="1.25" />
    </Icon>
  );
}

export function TasksIcon({ size = 15 }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 16 16">
      <circle
        cx="5"
        cy="4.5"
        r="2.25"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <circle
        cx="5"
        cy="11.5"
        r="2.25"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path
        d="M9.5 4.5h4M9.5 11.5h4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.25"
      />
    </Icon>
  );
}

export function SwitchIcon({ size = 12 }: IconProps) {
  return (
    <Icon size={size} viewBox="0 0 12 12">
      <path
        d="M3.5 4.75 6 2.5l2.5 2.25M3.5 7.25 6 9.5l2.5-2.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
    </Icon>
  );
}
