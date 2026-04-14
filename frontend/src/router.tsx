import { lazy, type ReactNode, Suspense } from "react";
import { createBrowserRouter, Outlet } from "react-router-dom";
import { userRoutes } from "./user-routes";
import { AppProvider } from "./components/AppProvider";

export const SuspenseWrapper = ({ children }: { children: ReactNode }) => {
  return (
    <Suspense fallback={
      <div className="container mx-auto py-16 flex justify-center items-center">
        <div className="text-center text-muted-foreground animate-pulse">Lade Ansicht...</div>
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
          <SuspenseWrapper>
            <Outlet />
          </SuspenseWrapper>
        </AppProvider>
      ),
      children: userRoutes
    },
    {
      path: "*",
      element: (
        <SuspenseWrapper>
          <NotFoundPage />
        </SuspenseWrapper>
      ),
      errorElement: (
        <SuspenseWrapper>
          <SomethingWentWrongPage />
        </SuspenseWrapper>
      ),
    },
  ]
);
