import { ProdErrorPage } from "../prod-components/ProdErrorPage";

export default function NotFoundPage() {
  return <ProdErrorPage code="404" title="Diese Nummer gibt es nicht." text="Die Seite wurde verschoben oder der Link ist falsch." canRefresh={false} />;
}
