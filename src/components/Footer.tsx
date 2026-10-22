import Link from "next/link";
import { CoffeeIcon } from "./ui";

export function Footer() {
  return (
    <footer className="wrap">
      <div className="site-footer">
        <span>
          Data comes from each provider&apos;s public status page, checked every 5 minutes. Severity is assigned by downagain.{" "}
          <Link href="/about">How it works</Link>.
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
