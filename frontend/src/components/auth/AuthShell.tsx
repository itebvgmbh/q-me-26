import { ReactNode, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Rahmen für Anmelden/Registrieren: große Überschrift, eine Karte, Links darunter */
export const AuthShell = ({ title, intro, children, footer }: { title: string; intro?: ReactNode; children: ReactNode; footer?: ReactNode }) => (
  <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-10 sm:py-16">
    <div className="flex flex-col gap-2">
      <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{title}</h1>
      {intro && <p className="text-muted-foreground">{intro}</p>}
    </div>
    <div className="rounded-3xl border border-border bg-card p-5 sm:p-6">{children}</div>
    {footer && <div className="flex flex-col gap-2 text-sm text-muted-foreground">{footer}</div>}
  </div>
);

export const FormError = ({ children }: { children: ReactNode }) => (
  <p role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
    {children}
  </p>
);

export const EmailField = ({ value, onChange, invalid }: { value: string; onChange: (v: string) => void; invalid?: boolean }) => (
  <div className="flex flex-col gap-2">
    <Label htmlFor="email">E-Mail</Label>
    <Input
      id="email"
      type="email"
      autoComplete="email"
      inputMode="email"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={invalid || undefined}
      required
    />
  </div>
);

/** Passwortfeld mit Anzeigen-Schalter statt zweitem Bestätigungsfeld */
export const PasswordField = ({ value, onChange, isNew = false }: { value: string; onChange: (v: string) => void; isNew?: boolean }) => {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="password">Passwort</Label>
      <div className="relative">
        <Input
          id="password"
          type={visible ? 'text' : 'password'}
          autoComplete={isNew ? 'new-password' : 'current-password'}
          minLength={isNew ? 6 : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pr-12"
          aria-describedby={isNew ? 'password-hint' : undefined}
          required
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          aria-label={visible ? 'Passwort verbergen' : 'Passwort anzeigen'}
          aria-pressed={visible}
        >
          {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      {isNew && (
        <p id="password-hint" className="text-xs text-muted-foreground">
          Mindestens 6 Zeichen.
        </p>
      )}
    </div>
  );
};
