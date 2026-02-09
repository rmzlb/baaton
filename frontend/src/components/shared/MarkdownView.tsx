import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface MarkdownViewProps {
  content: string;
  className?: string;
}

export function MarkdownView({ content, className }: MarkdownViewProps) {
  return (
    <div className={cn('baaton-markdown', className)}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="text-xl font-bold text-primary mt-4 mb-2 first:mt-0">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-lg font-semibold text-primary mt-3 mb-1.5">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-base font-semibold text-primary mt-2 mb-1">{children}</h3>
        ),
        h4: ({ children }) => (
          <h4 className="text-sm font-semibold text-primary mt-2 mb-1">{children}</h4>
        ),
        p: ({ children }) => (
          <p className="text-sm text-primary/90 leading-relaxed mb-2 last:mb-0">{children}</p>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            {children}
          </a>
        ),
        ul: ({ children }) => (
          <ul className="list-disc list-inside text-sm text-primary/90 space-y-1 mb-2 pl-1">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal list-inside text-sm text-primary/90 space-y-1 mb-2 pl-1">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="text-sm text-primary/90 leading-relaxed">{children}</li>
        ),
        code: ({ className: codeClassName, children, ...props }) => {
          const isInline = !codeClassName;
          if (isInline) {
            return (
              <code className="rounded bg-surface-hover px-1.5 py-0.5 text-xs font-mono text-accent">
                {children}
              </code>
            );
          }
          return (
            <code className={cn('block rounded-lg bg-surface-hover p-3 text-xs font-mono text-primary/90 overflow-x-auto mb-2', codeClassName)} {...props}>
              {children}
            </code>
          );
        },
        pre: ({ children }) => (
          <pre className="rounded-lg bg-surface-hover border border-border p-3 text-xs font-mono text-primary/90 overflow-x-auto mb-2">
            {children}
          </pre>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-accent/50 pl-3 italic text-secondary text-sm mb-2">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="border-border my-3" />,
        table: ({ children }) => (
          <div className="overflow-x-auto mb-2">
            <table className="w-full text-xs border-collapse border border-border rounded-lg">
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-surface-hover">{children}</thead>
        ),
        th: ({ children }) => (
          <th className="border border-border px-3 py-1.5 text-left text-xs font-semibold text-primary">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="border border-border px-3 py-1.5 text-xs text-primary/90">
            {children}
          </td>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-primary">{children}</strong>
        ),
        em: ({ children }) => (
          <em className="italic text-secondary">{children}</em>
        ),
        del: ({ children }) => (
          <del className="line-through text-muted">{children}</del>
        ),
        input: ({ checked, ...props }) => (
          <input
            type="checkbox"
            checked={checked}
            readOnly
            className="mr-1.5 accent-accent"
            {...props}
          />
        ),
        img: ({ src, alt }) => (
          <img
            src={src}
            alt={alt || ''}
            className="rounded-lg max-w-full h-auto border border-border my-2"
          />
        ),
      }}
    >
      {content}
    </ReactMarkdown>
    </div>
  );
}
