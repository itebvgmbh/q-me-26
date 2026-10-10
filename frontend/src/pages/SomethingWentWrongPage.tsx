import { ProdErrorPage } from "../prod-components/ProdErrorPage";

export default function SomethingWentWrongPage() {
  return <ProdErrorPage title="Da ist was schiefgelaufen." text="Lad die Seite neu. Wenn es wieder passiert, versuch es in ein paar Minuten noch einmal." canRefresh={true} />;
}
