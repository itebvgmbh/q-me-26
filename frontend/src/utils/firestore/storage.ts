import { auth } from 'app';
import { t } from '@/i18n';

/**
 * Logo oder Foto hochladen (requirements/eigene-datenbank.md, Stufe 2). Die Bilder liegen auf unserem Server
 * (backend/app/libs/laeden.py, POST /routes/team/laeden/{id}/bild), nicht mehr in Firebase Storage; ältere Bilder
 * behalten ihre Adresse. Nur der Inhaber, nur PNG, JPEG oder WebP bis 5 MB.
 * @param path "shop-logos/{shopId}" oder "staff-profile-images/{shopId}" (wie bisher)
 * @returns Die Adresse, die in logoUrl bzw. profileImageUrl gehört
 */
export const uploadImage = async (file: File, path: string): Promise<string> => {
  const [ordner, shopId] = path.split('/');
  if (!shopId) throw new Error(t('Das hat nicht geklappt.'));
  const form = new FormData();
  form.append('datei', file);
  form.append('art', ordner === 'shop-logos' ? 'logo' : 'person');
  const res = await fetch(`/routes/team/laeden/${encodeURIComponent(shopId)}/bild`, {
    method: 'POST',
    headers: { Authorization: await auth.getAuthHeaderValue() },
    body: form,
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.detail;
    } catch {
      /* keine JSON-Antwort */
    }
    throw new Error(typeof detail === 'string' && detail ? detail : t('Das hat nicht geklappt (Fehler {status}).', { status: res.status }));
  }
  return (await res.json()).url as string;
};
