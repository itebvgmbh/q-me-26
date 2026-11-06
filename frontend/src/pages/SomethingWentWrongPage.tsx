import { ProdErrorPage } from "../prod-components/ProdErrorPage";
import { t } from "@/i18n";

export default function SomethingWentWrongPage() {
  return <ProdErrorPage title={t("Da ist was schiefgelaufen.")} text={t("Lad die Seite neu. Wenn es wieder passiert, versuch es in ein paar Minuten noch einmal.")} canRefresh={true} />;
}
