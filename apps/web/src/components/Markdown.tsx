import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        img: () => null,
        // A table gets a scroll container of its own, the way `pre` already
        // has one. Without a wrapper the only way to make a <table> scroll is
        // `display: block` on the table itself, which quietly stops being a
        // table for layout purposes and squeezes wide columns instead of
        // overflowing them. `tabIndex={0}` so the scroll box is reachable by
        // keyboard: a region that scrolls and cannot be focused is content a
        // keyboard user cannot read.
        table: ({ children }) => (
          <div
            className="markdown-table-scroll"
            tabIndex={0}
            role="region"
            aria-label="Table"
          >
            <table>{children}</table>
          </div>
        ),
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
