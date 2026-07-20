interface SpotifyLogoProps {
  size?: number;
  className?: string;
  label?: string;
}

export function SpotifyLogo({ size = 20, className, label }: SpotifyLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0Zm5.505 17.331a.747.747 0 0 1-1.028.248c-2.817-1.722-6.363-2.112-10.54-1.159a.747.747 0 1 1-.332-1.457c4.571-1.043 8.482-.605 11.627 1.318a.747.747 0 0 1 .273 1.05Zm1.468-3.265a.934.934 0 0 1-1.285.308c-3.224-1.974-8.14-2.546-11.948-1.39a.934.934 0 0 1-.543-1.788c4.35-1.32 9.762-.68 13.444 1.575a.934.934 0 0 1 .332 1.295Zm.126-3.4C15.228 8.367 8.838 8.16 5.137 9.284a1.12 1.12 0 0 1-.65-2.144c4.25-1.29 11.32-1.04 15.782 1.607a1.12 1.12 0 0 1-1.17 1.92Z" />
    </svg>
  );
}
