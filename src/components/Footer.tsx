import Link from "next/link";
import { CoffeeIcon } from "./ui";

export function Footer() {
  return (
    <footer className="wrap">
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
