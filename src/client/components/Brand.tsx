export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="brand-mark"
    >
      <path
        d="M8 10.5 22 7.5M8 10.5 21 23M11 24.5 21 23M11 24.5 22 7.5"
        stroke="currentColor"
        strokeOpacity="0.42"
        strokeWidth="1"
      />
      <circle cx="8" cy="10.5" r="2.6" fill="var(--rust)" />
      <circle cx="22" cy="7.5" r="1.6" fill="currentColor" fillOpacity="0.75" />
      <circle cx="21" cy="23" r="2.3" fill="currentColor" fillOpacity="0.95" />
      <circle cx="11" cy="24.5" r="1.5" fill="var(--rust)" />
      <circle cx="16" cy="16" r="1.3" fill="currentColor" fillOpacity="0.8" />
    </svg>
  );
}

export function LociAvatar({ size = 30 }: { size?: number }) {
  return (
    <span className="loci-avatar" style={{ width: size, height: size }}>
      <BrandMark size={size * 0.72} />
    </span>
  );
}
