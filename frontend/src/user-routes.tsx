
// Ursprünglich von Databutton erzeugt; wird seit dem Export von Hand gepflegt.
import { lazyPage } from "./utils/lazy-page";
import { RouteObject } from "react-router";
import { Navigate, useLocation } from "react-router-dom";


import { UserGuard } from "./app";

// Alte Seiten zeigen auf die gepflegten Abläufe; Query (shopId, serviceId) bleibt erhalten
const RedirectKeepQuery = ({ to }: { to: string }) => {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
};


const App = lazyPage(() => import("./pages/App.tsx"));
const Activate = lazyPage(() => import("./pages/Activate.tsx"));
const Agb = lazyPage(() => import("./pages/Agb.tsx"));
const Auswertung = lazyPage(() => import("./pages/Auswertung.tsx"));
const Betreiber = lazyPage(() => import("./pages/Betreiber.tsx"));
const Preise = lazyPage(() => import("./pages/Preise.tsx"));
const Tarif = lazyPage(() => import("./pages/Tarif.tsx"));
const BookAppointment = lazyPage(() => import("./pages/BookAppointment.tsx"));
const CodeHealth = lazyPage(() => import("./pages/CodeHealth.tsx"));
const CustomerProfile = lazyPage(() => import("./pages/CustomerProfile.tsx"));
const Datenschutz = lazyPage(() => import("./pages/Datenschutz.tsx"));
const EmailBestaetigen = lazyPage(() => import("./pages/EmailBestaetigen.tsx"));
const EmployeeDashboard = lazyPage(() => import("./pages/EmployeeDashboard.tsx"));
const Features = lazyPage(() => import("./pages/Features.tsx"));
const Impressum = lazyPage(() => import("./pages/Impressum.tsx"));
const Login = lazyPage(() => import("./pages/Login.tsx"));
const Logout = lazyPage(() => import("./pages/Logout.tsx"));
const MyBookings = lazyPage(() => import("./pages/MyBookings.tsx"));
const Nummer = lazyPage(() => import("./pages/Nummer.tsx"));
const Plakat = lazyPage(() => import("./pages/Plakat.tsx"));
const Profile = lazyPage(() => import("./pages/Profile.tsx"));
const PublicJoinQueue = lazyPage(() => import("./pages/PublicJoinQueue.tsx"));
const Register = lazyPage(() => import("./pages/Register.tsx"));
const RegisterCustomer = lazyPage(() => import("./pages/RegisterCustomer.tsx"));
const RegisterOptions = lazyPage(() => import("./pages/RegisterOptions.tsx"));
const RegisterShopOwner = lazyPage(() => import("./pages/RegisterShopOwner.tsx"));
const RoleSelection = lazyPage(() => import("./pages/RoleSelection.tsx"));
const SchedulerControl = lazyPage(() => import("./pages/SchedulerControl.tsx"));
const ServiceManagement = lazyPage(() => import("./pages/ServiceManagement.tsx"));
const ShopDashboard = lazyPage(() => import("./pages/ShopDashboard.tsx"));
const ShopDetails = lazyPage(() => import("./pages/ShopDetails.tsx"));
const ShopMap = lazyPage(() => import("./pages/ShopMap.tsx"));
const ShopProfile = lazyPage(() => import("./pages/ShopProfile.tsx"));
const ShopSetup = lazyPage(() => import("./pages/ShopSetup.tsx"));
const StaffManagement = lazyPage(() => import("./pages/StaffManagement.tsx"));
const StaffRegistration = lazyPage(() => import("./pages/StaffRegistration.tsx"));
const StadtWeiterleitung = lazyPage(() => import("./pages/StadtWeiterleitung.tsx"));

export const userRoutes: RouteObject[] = [

	{ path: "/", element: <App />},
	// Kunden-Link aus "Mein Tag" → Kunde anlegen
	{ path: "/activate", element: <Activate />},
	{ path: "/book-appointment", element: <BookAppointment />},
	{ path: "/bookappointment", element: <BookAppointment />},
	{ path: "/code-health", element: <UserGuard><CodeHealth /></UserGuard>},
	{ path: "/codehealth", element: <UserGuard><CodeHealth /></UserGuard>},
	{ path: "/customer-dashboard", element: <RedirectKeepQuery to="/my-bookings" />},
	{ path: "/customerdashboard", element: <RedirectKeepQuery to="/my-bookings" />},
	{ path: "/customer-profile", element: <UserGuard><CustomerProfile /></UserGuard>},
	{ path: "/customerprofile", element: <UserGuard><CustomerProfile /></UserGuard>},
	// Link aus der Bestätigungs-Mail (utils/email-verification.ts)
	{ path: "/email-bestaetigen", element: <EmailBestaetigen />},
	{ path: "/employee-dashboard", element: <UserGuard><EmployeeDashboard /></UserGuard>},
	{ path: "/employeedashboard", element: <UserGuard><EmployeeDashboard /></UserGuard>},
	{ path: "/features", element: <Features />},
	{ path: "/impressum", element: <Impressum />},
	{ path: "/datenschutz", element: <Datenschutz />},
	{ path: "/agb", element: <Agb />},
	{ path: "/preise", element: <Preise />},
	{ path: "/tarif", element: <UserGuard><Tarif /></UserGuard>},
	{ path: "/auswertung", element: <UserGuard><Auswertung /></UserGuard>},
	// Nur für den Betreiber der App; das Backend prüft jeden Aufruf (backend/app/apis/betreiber)
	{ path: "/betreiber", element: <UserGuard><Betreiber /></UserGuard>},
	{ path: "/plakat", element: <UserGuard><Plakat /></UserGuard>},
	{ path: "/friseur-ohne-termin/*", element: <StadtWeiterleitung />},
	{ path: "/friseur-ohne-termin", element: <StadtWeiterleitung />},
	{ path: "/hilfe/*", element: <StadtWeiterleitung />},
	{ path: "/friseur/*", element: <StadtWeiterleitung />},
	{ path: "/friseur", element: <StadtWeiterleitung />},
	{ path: "/barbershop/*", element: <StadtWeiterleitung />},
	{ path: "/barbershop", element: <StadtWeiterleitung />},
	{ path: "/hilfe", element: <StadtWeiterleitung />},
	{ path: "/join-queue", element: <RedirectKeepQuery to="/public-join-queue" />},
	{ path: "/joinqueue", element: <RedirectKeepQuery to="/public-join-queue" />},
	{ path: "/join-queue-refactored", element: <RedirectKeepQuery to="/public-join-queue" />},
	{ path: "/joinqueuerefactored", element: <RedirectKeepQuery to="/public-join-queue" />},
	{ path: "/login", element: <Login />},
	{ path: "/logout", element: <UserGuard><Logout /></UserGuard>},
	{ path: "/my-bookings", element: <UserGuard><MyBookings /></UserGuard>},
	{ path: "/mybookings", element: <UserGuard><MyBookings /></UserGuard>},
	{ path: "/nummer/:id", element: <Nummer />},
	{ path: "/profile", element: <UserGuard><Profile /></UserGuard>},
	{ path: "/public-join-queue", element: <PublicJoinQueue />},
	{ path: "/publicjoinqueue", element: <PublicJoinQueue />},
	{ path: "/register", element: <Register />},
	{ path: "/register-customer", element: <RegisterCustomer />},
	{ path: "/registercustomer", element: <RegisterCustomer />},
	{ path: "/register-options", element: <RegisterOptions />},
	{ path: "/registeroptions", element: <RegisterOptions />},
	{ path: "/register-shop-owner", element: <RegisterShopOwner />},
	{ path: "/registershopowner", element: <RegisterShopOwner />},
	{ path: "/role-selection", element: <UserGuard><RoleSelection /></UserGuard>},
	{ path: "/roleselection", element: <UserGuard><RoleSelection /></UserGuard>},
	{ path: "/scheduler-control", element: <UserGuard><SchedulerControl /></UserGuard>},
	{ path: "/schedulercontrol", element: <UserGuard><SchedulerControl /></UserGuard>},
	{ path: "/service-booking", element: <RedirectKeepQuery to="/book-appointment" />},
	{ path: "/servicebooking", element: <RedirectKeepQuery to="/book-appointment" />},
	{ path: "/service-management", element: <UserGuard><ServiceManagement /></UserGuard>},
	{ path: "/servicemanagement", element: <UserGuard><ServiceManagement /></UserGuard>},
	{ path: "/shop-dashboard", element: <UserGuard><ShopDashboard /></UserGuard>},
	{ path: "/shopdashboard", element: <UserGuard><ShopDashboard /></UserGuard>},
	{ path: "/shop-details", element: <ShopDetails />},
	{ path: "/shopdetails", element: <ShopDetails />},
	{ path: "/shop-map", element: <ShopMap />},
	{ path: "/shopmap", element: <ShopMap />},
	{ path: "/shop-profile", element: <UserGuard><ShopProfile /></UserGuard>},
	{ path: "/shop-setup", element: <UserGuard><ShopSetup /></UserGuard>},
	{ path: "/shopsetup", element: <UserGuard><ShopSetup /></UserGuard>},
	{ path: "/laden-einrichten", element: <UserGuard><ShopSetup /></UserGuard>},
	{ path: "/shopprofile", element: <UserGuard><ShopProfile /></UserGuard>},
	{ path: "/staff-management", element: <UserGuard><StaffManagement /></UserGuard>},
	{ path: "/staffmanagement", element: <UserGuard><StaffManagement /></UserGuard>},
	{ path: "/staff-registration", element: <StaffRegistration />},
	{ path: "/staffregistration", element: <StaffRegistration />},

];
