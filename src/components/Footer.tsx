import Link from "next/link";
import type { Snapshot } from "@/lib/data";
import { CoffeeIcon } from "./ui";

export function Footer({ snap }: { snap: Snapshot | null }) {
  return (
    <footer className="wrap">
      {snap ? (
        <nav className="site-directory" aria-label="Providers">
          {snap.categories.map((c) => (
            <div key={c.slug} className="stack" style={{ ["--gap" as string]: "6px" }}>
              <Link href={c.slug === snap.categories[0]?.slug ? "/" : `/c/${c.slug}`} className="eyebrow">
                {c.name}
              </Link>
              {snap.providers
                .filter((p) => p.category === c.slug)
                .map((p) => (
                  <Link key={p.slug} href={`/p/${p.slug}`}>
                    {p.name}
                  </Link>
                ))}
            </div>
          ))}
        </nav>
      ) : null}
      <div className="site-footer">
        <span>
          From official status pages, every 5 minutes. <Link href="/about">How it works</Link>
          <br />
          Made by{" "}
          <a href="https://ejqs.net" target="_blank" rel="noopener">
            @ejqs
          </a>
          {" · "}
          <a href="https://github.com/ejqs/downagain">Source</a>
        </span>
        <span className="row" style={{ ["--gap" as string]: "8px 16px" }}>
          <span className="mono" style={{ fontSize: 13 }}>Hosted on Railway. Yes, we know.</span>
          <a className="bmc" href="https://buymeacoffee.com/ejqs" data-umami-event="coffee">
            <CoffeeIcon />
            Buy me a coffee
          </a>
        </span>
      </div>
    </footer>
  );
}
