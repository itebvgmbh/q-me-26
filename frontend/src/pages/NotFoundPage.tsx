import { ProdErrorPage } from "../prod-components/ProdErrorPage";
import { t } from "@/i18n";

export default function NotFoundPage() {
  return <ProdErrorPage code="404" title={t("Diese Nummer gibt es nicht.")} text={t("Die Seite wurde verschoben oder der Link ist falsch.")} canRefresh={false} />;
}
