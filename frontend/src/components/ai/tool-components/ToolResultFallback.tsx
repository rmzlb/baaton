import { MarkdownView } from '@/components/shared/MarkdownView';

interface ToolResultFallbackProps {
  /** Human-readable summary from the tool result (supports markdown). */
  summary: string;
}

/** Generic fallback rendered when no custom component matches the tool result. */
export default function ToolResultFallback({ summary }: ToolResultFallbackProps) {
  if (!summary) return null;
  return (
    <div className="rounded-md bg-[--color-surface-hover] px-3 py-2">
      <MarkdownView content={summary} />
    </div>
  );
}
