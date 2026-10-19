import type { ReactNode } from 'react';

/** Gemeinsamer Rahmen für Impressum, Datenschutz und AGB: ruhige Lesespalte */
export const LegalPage = ({ title, updated, children }: { title: string; updated?: string; children: ReactNode }) => (
  <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12 sm:px-6 md:py-16">
    <header className="flex flex-col gap-2">
      <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{title}</h1>
      {updated && <p className="text-sm text-muted-foreground">Stand: {updated}</p>}
    </header>
    <div className="flex flex-col gap-8 text-[15px] leading-relaxed [&_a]:underline [&_a]:underline-offset-2 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-bold [&_h2]:tracking-[-0.02em] [&_li]:ml-5 [&_li]:list-disc [&_section]:flex [&_section]:flex-col [&_section]:gap-3 [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-1.5">
      {children}
    </div>
  </div>
);
