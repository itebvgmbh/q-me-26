import { lazy, type ReactNode, Suspense } from "react";
import { createBrowserRouter, Outlet } from "react-router-dom";
import { userRoutes } from "./user-routes";
import { AppProvider } from "./components/AppProvider";
import { Navigation } from "./components/Navigation";
import { SiteFooter } from "./components/brand/SiteFooter";

export const SuspenseWrapper = ({ children }: { children: ReactNode }) => {
  return (
    <Suspense fallback={
      <div className="flex min-h-[50vh] items-center justify-center" role="status" aria-live="polite">
        <span className="h-8 w-8 animate-spin rounded-full border-4 border-foreground/15 border-t-foreground" aria-hidden="true" />
        <span className="sr-only">Wird geladen …</span>
      </div>
    }>
      {children}
    </Suspense>
  );
};

const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));
const SomethingWentWrongPage = lazy(
  () => import("./pages/SomethingWentWrongPage"),
);

export const router = createBrowserRouter(
  [
    {
      element: (
        <AppProvider>
          <div className="flex min-h-screen flex-col">
            <Navigation />
            <main id="inhalt" className="flex-1">
              <SuspenseWrapper>
                <Outlet />
              </SuspenseWrapper>
            </main>
            <SiteFooter />
          </div>
        </AppProvider>
      ),
      children: userRoutes
    },
    {
      path: "*",
      element: (
        <div className="flex min-h-screen flex-col">
          <Navigation />
          <main id="inhalt" className="flex-1">
            <SuspenseWrapper>
              <NotFoundPage />
            </SuspenseWrapper>
          </main>
        </div>
      ),
      errorElement: (
        <SuspenseWrapper>
          <SomethingWentWrongPage />
        </SuspenseWrapper>
      ),
    },
  ]
);
