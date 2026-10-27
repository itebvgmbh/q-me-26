import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { DraftService, newKey } from '../../utils/shop-setup';
import { intlSprache, t } from '@/i18n';

interface Props {
  services: DraftService[];
  onChange: (services: DraftService[]) => void;
  /** Überschrift über den Vorlagen, z. B. "Typisch für Friseure" */
  templateTitle: string;
}

const zahl = (n: number) => n.toLocaleString(intlSprache(), { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const preis = (s: DraftService) =>
  !s.price ? t('ohne Preis') : s.priceFrom ? t('ab {preis} €', { preis: zahl(s.price) }) : t('{preis} €', { preis: zahl(s.price) });

const Row = ({ s, update, remove }: { s: DraftService; update: (patch: Partial<DraftService>) => void; remove?: () => void }) => (
  <li className={cn('flex flex-col gap-3 rounded-2xl border p-3 transition-colors', s.selected ? 'border-foreground bg-background' : 'border-border bg-background/60')}>
    <div className="flex items-start gap-3">
      <Checkbox
        checked={s.selected}
        onCheckedChange={(v) => update({ selected: v === true })}
        aria-label={t('{name} anbieten', { name: s.name || t('Leistung') })}
        className="mt-1 h-5 w-5"
      />
      {s.selected ? (
        <Input
          value={s.name}
          onChange={(e) => update({ name: e.target.value })}
          placeholder={t('Name der Leistung')}
          aria-label={t('Name der Leistung')}
          autoFocus={s.source === 'own' && !s.name}
          className="h-10 flex-1"
        />
      ) : (
        <button type="button" className="flex min-w-0 flex-1 flex-col text-start" onClick={() => update({ selected: true })}>
          <span className="font-semibold">{s.name}</span>
          <span className="text-sm text-muted-foreground">
            {[s.category, t('{dauer} Min.', { dauer: s.duration }), preis(s)].filter(Boolean).join(' · ')}
          </span>
        </button>
      )}
      {remove && (
        <Button type="button" variant="ghost" size="icon" onClick={remove} aria-label={t('Leistung entfernen')}>
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
    </div>
    {s.selected && (
      <div className="flex flex-wrap items-end gap-3 ps-8">
        <label className="flex w-28 flex-col gap-1 text-xs font-semibold text-muted-foreground">
          {s.durationGuessed ? t('Dauer (Min.) – geschätzt') : t('Dauer (Min.)')}
          <Input
            type="number"
            inputMode="numeric"
            min={5}
            step={5}
            value={s.duration || ''}
            onChange={(e) => update({ duration: Math.max(0, Math.round(Number(e.target.value) || 0)), durationGuessed: false })}
            className="h-10 font-mono text-base text-foreground"
          />
        </label>
        <label className="flex w-28 flex-col gap-1 text-xs font-semibold text-muted-foreground">
          {s.priceFrom ? t('Preis (ab €)') : t('Preis (€)')}
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step={0.5}
            value={s.price || ''}
            placeholder="0"
            onChange={(e) => update({ price: Math.max(0, Number(e.target.value.replace(',', '.')) || 0) })}
            className="h-10 font-mono text-base text-foreground"
          />
        </label>
      </div>
    )}
  </li>
);

/** Leistungen ankreuzen und Dauer/Preis direkt anpassen */
export const ServicePicker = ({ services, onChange, templateTitle }: Props) => {
  // Wer selbst an- oder abhakt, entscheidet – die Webseite wählt das dann nicht mehr ab
  const update = (key: string, patch: Partial<DraftService>) =>
    onChange(services.map((s) => (s.key === key ? { ...s, ...patch, ...('selected' in patch ? { autoSelected: false } : {}) } : s)));
  const remove = (key: string) => onChange(services.filter((s) => s.key !== key));
  const groups: { title: string; items: DraftService[]; removable: boolean }[] = [
    { title: t('Von deiner Webseite'), items: services.filter((s) => s.source === 'website'), removable: true },
    { title: templateTitle, items: services.filter((s) => s.source === 'template'), removable: false },
    { title: t('Eigene'), items: services.filter((s) => s.source === 'own'), removable: true },
  ];

  return (
    <div className="flex flex-col gap-5">
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <section key={g.title} className="flex flex-col gap-2" aria-label={g.title}>
            <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{g.title}</h3>
            <ul className="flex flex-col gap-2">
              {g.items.map((s) => (
                <Row key={s.key} s={s} update={(patch) => update(s.key, patch)} remove={g.removable ? () => remove(s.key) : undefined} />
              ))}
            </ul>
          </section>
        ))}
      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() => onChange([...services, { key: newKey('o'), name: '', category: '', duration: 30, price: 0, selected: true, source: 'own' }])}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        {t('Eigene Leistung')}
      </Button>
    </div>
  );
};
