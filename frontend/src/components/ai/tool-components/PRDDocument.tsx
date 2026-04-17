import { FileText, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { MarkdownView } from '@/components/shared/MarkdownView';

interface PRDSection {
  title: string;
  content: string;
}

interface PRDData {
  title?: string;
  version?: string;
  author?: string;
  sections?: PRDSection[];
  content?: string;
}

interface PRDDocumentProps {
  data: PRDData;
}

export default function PRDDocument({ data }: PRDDocumentProps) {
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set([0]));

  const toggle = (i: number) =>
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });

  // If data is flat content string (no sections), render directly
  if (!data.sections?.length && data.content) {
    return (
      <div className="rounded-lg border border-[--color-border] bg-[--color-surface] p-4">
        <div className="flex items-center gap-2 mb-3">
          <FileText size={14} className="text-[--color-accent]" />
          <span className="text-sm font-semibold text-[--color-primary]">{data.title ?? 'PRD'}</span>
        </div>
        <MarkdownView content={data.content} />
      </div>
    );
  }

  const sections = data.sections ?? [];

  return (
    <div className="rounded-lg border border-[--color-border] bg-[--color-surface] overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[--color-border] bg-[--color-surface-hover]">
        <FileText size={14} className="text-[--color-accent]" />
        <span className="text-sm font-semibold text-[--color-primary]">{data.title ?? 'Product Requirements Document'}</span>
        {data.version && (
          <span className="ml-auto text-[10px] text-[--color-muted] font-mono">{data.version}</span>
        )}
      </div>

      <div className="divide-y divide-[--color-border]">
        {sections.map((section, i) => (
          <div key={i}>
            <button
              onClick={() => toggle(i)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-[--color-surface-hover] transition-colors"
            >
              <span className="text-xs font-semibold text-[--color-secondary] uppercase tracking-wide">
                {section.title}
              </span>
              <ChevronDown
                size={13}
                className={cn('text-[--color-muted] transition-transform', expandedSections.has(i) && 'rotate-180')}
              />
            </button>
            {expandedSections.has(i) && (
              <div className="px-4 pb-4">
                <MarkdownView content={section.content} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
