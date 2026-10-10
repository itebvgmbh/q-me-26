import type { ReactNode } from "react";

interface Props {
  /** große Zahl/Marke oben, z. B. "404" */
  code?: string;
  title?: ReactNode;
  text: ReactNode;
  canRefresh: boolean;
}

// Bewusst ohne Router-Abhängigkeit (<a> statt <Link>): die Seite muss auch rendern, wenn die App abstürzt
export const ProdErrorPage = ({ code, title, text, canRefresh }: Props) => (
  <div className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col justify-center gap-6 px-4 py-16">
    {code && (
      <div className="flex w-fit flex-col rounded-3xl bg-signal px-6 py-5 text-signal-foreground">
        <span className="text-xs font-semibold uppercase tracking-[0.08em]">Deine Nummer</span>
        <span className="font-mono text-7xl font-bold leading-none tracking-[-0.05em]">{code}</span>
      </div>
    )}
    <div className="flex flex-col gap-2">
      {title && <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em]">{title}</h1>}
      <p className="text-muted-foreground">{text}</p>
    </div>
    <div className="flex flex-wrap gap-2">
      {canRefresh && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground"
        >
          Neu laden
        </button>
      )}
      <a href="/" className="inline-flex h-11 items-center rounded-full border-2 border-foreground px-5 text-sm font-semibold">
        Zur Startseite
      </a>
    </div>
  </div>
);
