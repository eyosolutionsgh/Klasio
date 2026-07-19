/**
 * The app's icon set, as inline SVG.
 *
 * Local and inline on purpose. This product ships standalone and offline, and the service worker
 * caches a build with no network to fall back on — an icon font or a CDN sprite would render as
 * blank boxes on exactly the deployments that can least afford it. A dependency would also pull
 * several hundred glyphs to use a couple of dozen.
 *
 * Every icon is decorative: `aria-hidden` here, with the meaning carried by the button's own text
 * or its `aria-label`. A screen reader should never announce "icon".
 *
 * Sized in `em` so an icon tracks the type it sits beside, and stroked in `currentColor` so it
 * inherits whatever the surrounding text is doing — including the disabled and inverted states,
 * which a hard-coded fill would miss.
 */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...rest }: IconProps) {
  return (
    <svg
      width="1.15em"
      height="1.15em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* ---- form fields ---- */

export const MailIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" />
    <path d="m3.5 7 7.4 5.3a2 2 0 0 0 2.2 0L20.5 7" />
  </Svg>
);

export const PhoneIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.7 3.5H5.4A2 2 0 0 0 3.4 5.7C3.4 13.9 10.1 20.6 18.3 20.6a2 2 0 0 0 2.2-2v-2.3l-4.2-1.6-2 2a13.6 13.6 0 0 1-5-5l2-2Z" />
  </Svg>
);

export const LockIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
    <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
  </Svg>
);

export const UserIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M4.8 20.2a7.2 7.2 0 0 1 14.4 0" />
  </Svg>
);

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="10.8" cy="10.8" r="6.3" />
    <path d="m15.5 15.5 4.3 4.3" />
  </Svg>
);

export const CalendarIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.2" />
    <path d="M3.5 9.8h17M8.2 3.5v3M15.8 3.5v3" />
  </Svg>
);

export const KeyIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="12" r="3.8" />
    <path d="M11.8 12h8.7M17.8 12v3.2M20.5 12v2.4" />
  </Svg>
);

export const CashIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2.2" />
    <circle cx="12" cy="12" r="2.6" />
    <path d="M6 9.5v5M18 9.5v5" />
  </Svg>
);

/* ---- actions ---- */

export const SaveIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 4.5h10L19.5 8.5v11a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 19.5v-13a2 2 0 0 1 1.5-2Z" />
    <path d="M8 4.5v5h7M8 20.5v-5.5h8v5.5" />
  </Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6.5h16M9.5 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7" />
    <path d="M6.5 6.5 7.4 20a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-13.5" />
    <path d="M10.5 10.5v7M13.5 10.5v7" />
  </Svg>
);

export const SendIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20.8 3.2 10.4 13.6M20.8 3.2 14.2 21l-3.8-7.4L3 9.8Z" />
  </Svg>
);

export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5v11.5M7.6 10.8 12 15.2l4.4-4.4M4.5 19.5h15" />
  </Svg>
);

export const UploadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 15.5V4M7.6 8.4 12 4l4.4 4.4M4.5 19.5h15" />
  </Svg>
);

export const EditIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h4l10.4-10.4a2.1 2.1 0 0 0 0-3L17 5.2a2.1 2.1 0 0 0-3 0L4 15.6Z" />
    <path d="M13.3 6.3 17.7 10.7" />
  </Svg>
);

export const PrintIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 9V3.8h10V9" />
    <rect x="3.5" y="9" width="17" height="7.5" rx="1.8" />
    <path d="M7 14h10v6.2H7Z" />
  </Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 12.5 4.6 4.6L19 7.7" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const AlertIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.6v5M12 15.8v.4" />
  </Svg>
);

export const RefreshIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v4.5h-4.5" />
  </Svg>
);

/**
 * The pending indicator. Animated with a Tailwind utility rather than SMIL, so it stops when the
 * user has asked for reduced motion (see the `motion-reduce` rule where it is used).
 */
export const SpinnerIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5" opacity="0.9" />
  </Svg>
);
