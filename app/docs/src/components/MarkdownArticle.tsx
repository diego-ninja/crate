import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { slugify } from "@/lib/utils";

function headingId(text: string) {
  return slugify(text);
}

export function MarkdownArticle({ markdown }: { markdown: string }) {
  return (
    <div className="docs-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1>{children}</h1>,
          h2: ({ children }) => {
            const text = String(children).replace(/,/g, "");
            return <h2 id={headingId(text)}>{children}</h2>;
          },
          h3: ({ children }) => {
            const text = String(children).replace(/,/g, "");
            return <h3 id={headingId(text)}>{children}</h3>;
          },
          a: ({ href, children }) => (
            <a href={href} target={href?.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
              {children}
            </a>
          ),
          code: ({ className, children }) => {
            const isBlock = Boolean(className);
            if (isBlock) {
              return <code className={className}>{children}</code>;
            }
            return <code>{children}</code>;
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
