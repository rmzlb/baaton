import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  if (!content) return null;

  return (
    <div className={`prose prose-sm dark:prose-invert max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Custom heading styles
          h1: ({ children }) => <h1 className="text-lg font-bold mt-4 mb-2 text-primary">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-semibold mt-3 mb-1.5 text-primary">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1 text-primary">{children}</h3>,
          // Paragraphs
          p: ({ children }) => <p className="text-sm text-secondary mb-2 leading-relaxed">{children}</p>,
          // Lists
          ul: ({ children }) => <ul className="text-sm text-secondary mb-2 ml-4 list-disc space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="text-sm text-secondary mb-2 ml-4 list-decimal space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="text-sm text-secondary">{children}</li>,
          // Code
          code: ({ className: codeClassName, children, ...props }) => {
            const isInline = !codeClassName;
            if (isInline) {
              return (
                <code className="px-1.5 py-0.5 rounded bg-surface-hover text-accent text-xs font-mono" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className={`block p-3 rounded-lg bg-neutral-900 text-neutral-200 text-xs font-mono overflow-x-auto ${codeClassName || ''}`} {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => <pre className="mb-2 rounded-lg overflow-hidden">{children}</pre>,
          // Links
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
              {children}
            </a>
          ),
          // Blockquotes
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-accent/50 pl-3 my-2 text-secondary italic">
              {children}
            </blockquote>
          ),
          // Tables
          table: ({ children }) => (
            <div className="overflow-x-auto mb-2">
              <table className="min-w-full text-xs border border-border rounded">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="px-3 py-1.5 bg-surface-hover text-left font-medium text-primary border-b border-border">{children}</th>,
          td: ({ children }) => <td className="px-3 py-1.5 text-secondary border-b border-border">{children}</td>,
          // Horizontal rule
          hr: () => <hr className="my-3 border-border" />,
          // Checkboxes (GFM)
          input: ({ type, checked, ...props }) => {
            if (type === 'checkbox') {
              return (
                <input
                  type="checkbox"
                  checked={checked}
                  readOnly
                  className="mr-1.5 rounded border-border accent-accent"
                  {...props}
                />
              );
            }
            return <input type={type} {...props} />;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
