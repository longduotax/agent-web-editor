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
        //
        // `group`, not `region`. A named `region` is a LANDMARK, and there is
        // one of these per table with no way to name them apart -- a
        // transcript with three tables put "Table, Table, Table" in the
        // landmark list, which is worse than no landmark at all because the
        // list is how a screen-reader user navigates the whole page. `group`
        // is not a landmark, and it still carries the accessible name that
        // makes the focus stop mean something when a keyboard user tabs into
        // the scroll box. The name has to live on SOME role: `aria-label` on
        // a bare div (role `generic`) is prohibited by ARIA and dropped.
        table: ({ children }) => (
          <div
            className="markdown-table-scroll"
            tabIndex={0}
            role="group"
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
