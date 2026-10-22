export function Unavailable() {
  return (
    <main className="wrap">
      {/* Keep a database blip out of search results; React hoists this into <head>. */}
      <meta name="robots" content="noindex" />
      <div className="section empty">
        <strong>We&apos;re down again.</strong> Can&apos;t reach our database. Try again in a minute.
      </div>
    </main>
  );
}
