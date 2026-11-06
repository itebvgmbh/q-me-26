import { type ReactNode, Suspense, useEffect } from "react";
import { createBrowserRouter, Outlet, useLocation, useNavigationType, useRouteError } from "react-router-dom";
import { userRoutes } from "./user-routes";
import { lazyPage } from "./utils/lazy-page";
// Nicht nachgeladen: Die Fehlerseite muss auch kommen, wenn das Nachladen der Fehler ist
import SomethingWentWrongPage from "./pages/SomethingWentWrongPage";
import { AppProvider } from "./components/AppProvider";
import { Navigation } from "./components/Navigation";
import { SiteFooter } from "./components/brand/SiteFooter";
import { SeitenKopf } from "./components/SeitenKopf";
import { LadenProvider } from "./utils/laden-kontext";
import { t } from "@/i18n";

export const SuspenseWrapper = ({ children }: { children: ReactNode }) => {
  return (
    <Suspense fallback={
      <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-live="polite">
        <span className="h-8 w-8 animate-spin rounded-full border-4 border-foreground/15 border-t-foreground" aria-hidden="true" />
        <span className="sr-only">{t("Wird geladen …")}</span>
      </div>
    }>
      {children}
    </Suspense>
  );
};

const NotFoundPage = lazyPage(() => import("./pages/NotFoundPage"));
// Vollbild für den Fernseher im Laden: ohne Navigation und Fußzeile
const Bildschirm = lazyPage(() => import("./pages/Bildschirm"));

// Neue Seite beginnt oben – sonst bleibt die Scrollposition der vorigen stehen (nach „Nummer ziehen“ landete man unten).
// Nur bei neuen Seiten (PUSH): „Zurück“ (POP) und Umschalten innerhalb einer Seite (REPLACE, z. B. Nummer ↔ Termin) nicht.
const NachObenBeiSeitenwechsel = () => {
  const { pathname } = useLocation();
  const art = useNavigationType();
  useEffect(() => {
    if (art === "PUSH") window.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  return null;
};

// Statt der englischen Standardseite von React Router („Unexpected Application Error!“)
const RouteError = () => {
  const error = useRouteError();
  useEffect(() => console.error(error), [error]);
  return <SomethingWentWrongPage />;
};

export const router = createBrowserRouter(
  [
    {
      element: (
        <AppProvider>
          {/* Gewählter Laden für Kopfzeile und Seiten (utils/laden-kontext.tsx) */}
          <LadenProvider>
            <SeitenKopf />
            <NachObenBeiSeitenwechsel />
            <div className="flex min-h-screen flex-col">
              <Navigation />
              <main id="inhalt" className="flex-1">
                <SuspenseWrapper>
                  <Outlet />
                </SuspenseWrapper>
              </main>
              <SiteFooter />
            </div>
          </LadenProvider>
        </AppProvider>
      ),
      errorElement: <RouteError />,
      children: userRoutes
    },
    {
      path: "/bildschirm/:shopId",
      element: (
        <SuspenseWrapper>
          <Bildschirm />
        </SuspenseWrapper>
      ),
      errorElement: <RouteError />,
    },
    {
      path: "*",
      element: (
        <div className="flex min-h-screen flex-col">
          <SeitenKopf />
          <Navigation />
          <main id="inhalt" className="flex-1">
            <SuspenseWrapper>
              <NotFoundPage />
            </SuspenseWrapper>
          </main>
        </div>
      ),
      errorElement: <RouteError />,
    },
  ]
);
