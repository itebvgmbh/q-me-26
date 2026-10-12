import { useState } from 'react';
import { Store } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Logo des Ladens; fehlt es oder lädt nicht, erscheint das Laden-Symbol */
export const ShopLogo = ({ url, className }: { url?: string; className?: string }) => {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return <img src={url} alt="" onError={() => setFailed(true)} className={cn('h-16 w-16 shrink-0 rounded-2xl border border-border object-cover', className)} />;
  }
  return (
    <span className={cn('flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-foreground text-signal', className)} aria-hidden="true">
      <Store className="h-7 w-7" />
    </span>
  );
};
