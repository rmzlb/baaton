export function TelegramIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className}>
      <circle cx="12" cy="12" r="12" fill="#2AABEE" />
      <path
        d="M5.49 11.74l11.57-4.46c.54-.19 1.01.13.83.94l-1.97 9.28c-.15.66-.54.82-1.08.51l-3-2.21-1.45 1.39c-.16.16-.3.3-.6.3l.21-3.05 5.56-5.02c.24-.21-.05-.33-.37-.12l-6.87 4.33-2.96-.93c-.64-.2-.66-.64.14-.95z"
        fill="white"
      />
    </svg>
  );
}

