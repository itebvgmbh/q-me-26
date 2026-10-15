import { useEffect, useRef, useState } from 'react';
import { Loader2, MapPin, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { PlaceDetailsData, PlaceSuggestion } from '../../brain/data-contracts';
import { placeDetails, searchPlaces } from '../../utils/shop-setup';

const token = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

interface Props {
  query: string;
  onQueryChange: (q: string) => void;
  onPicked: (place: PlaceDetailsData) => void;
}

/** Laden bei Google suchen: tippen, Vorschlag antippen, fertig */
export const PlaceSearch = ({ query, onQueryChange, onPicked }: Props) => {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  // Ein Token je Suche: Google rechnet Tippen + Auswahl dann als eine Anfrage ab
  const session = useRef(token());

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearching(true);
      setError('');
      try {
        const result = await searchPlaces(q, session.current, controller.signal);
        setSuggestions(result.suggestions);
      } catch (e) {
        if (!controller.signal.aborted) setError((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const pick = async (s: PlaceSuggestion) => {
    setLoadingId(s.place_id);
    setError('');
    try {
      const place = await placeDetails(s.place_id, session.current);
      session.current = token();
      onPicked(place);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="laden-suche" className="sr-only">
        Name deines Ladens und Ort
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          id="laden-suche"
          autoFocus
          autoComplete="off"
          enterKeyHint="search"
          placeholder="z. B. Salon Schnittig Leipzig"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="h-14 rounded-2xl pl-12 text-base"
        />
        {searching && <Loader2 className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-muted-foreground" aria-label="Suche läuft" />}
      </div>
      {error && (
        <p role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {suggestions.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Vorschläge von Google">
          {suggestions.map((s) => (
            <li key={s.place_id}>
              <button
                type="button"
                onClick={() => pick(s)}
                disabled={loadingId !== null}
                className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-border bg-background px-4 py-3 text-left transition-colors hover:border-foreground disabled:opacity-60"
              >
                {loadingId === s.place_id ? (
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden="true" />
                ) : (
                  <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold">{s.title}</span>
                  <span className="truncate text-sm text-muted-foreground">{loadingId === s.place_id ? 'Hole die Angaben von Google …' : s.subtitle}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim().length >= 3 && !searching && suggestions.length === 0 && !error && (
        <p className="text-sm text-muted-foreground">Nichts gefunden. Probier es mit dem Ort dazu – oder trag deinen Laden selbst ein.</p>
      )}
    </div>
  );
};
