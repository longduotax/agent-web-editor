import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        img: () => null,
        a: ({ children: linkChildren, href, title }) => (
          <a
            href={href}
            title={title}
            rel="noreferrer noopener"
            target="_blank"
          >
            {linkChildren}
          </a>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
