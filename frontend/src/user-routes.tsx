
// Ursprünglich von Databutton erzeugt; wird seit dem Export von Hand gepflegt.
import { lazy } from "react";
import { RouteObject } from "react-router";
import { Navigate, useLocation } from "react-router-dom";


import { UserGuard } from "./app";

// Alte Buchungsseiten zeigen auf die zwei gepflegten Abläufe; Query (shopId, serviceId) bleibt erhalten
const RedirectKeepQuery = ({ to }: { to: string }) => {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
};


const App = lazy(() => import("./pages/App.tsx"));
const BookAppointment = lazy(() => import("./pages/BookAppointment.tsx"));
const CodeHealth = lazy(() => import("./pages/CodeHealth.tsx"));
const CustomerDashboard = lazy(() => import("./pages/CustomerDashboard.tsx"));
const CustomerProfile = lazy(() => import("./pages/CustomerProfile.tsx"));
const EmployeeDashboard = lazy(() => import("./pages/EmployeeDashboard.tsx"));
const Features = lazy(() => import("./pages/Features.tsx"));
const Login = lazy(() => import("./pages/Login.tsx"));
const Logout = lazy(() => import("./pages/Logout.tsx"));
const MyBookings = lazy(() => import("./pages/MyBookings.tsx"));
const Profile = lazy(() => import("./pages/Profile.tsx"));
const PublicJoinQueue = lazy(() => import("./pages/PublicJoinQueue.tsx"));
const Register = lazy(() => import("./pages/Register.tsx"));
const RegisterCustomer = lazy(() => import("./pages/RegisterCustomer.tsx"));
const RegisterOptions = lazy(() => import("./pages/RegisterOptions.tsx"));
const RegisterShopOwner = lazy(() => import("./pages/RegisterShopOwner.tsx"));
const RoleSelection = lazy(() => import("./pages/RoleSelection.tsx"));
const SchedulerControl = lazy(() => import("./pages/SchedulerControl.tsx"));
const ServiceManagement = lazy(() => import("./pages/ServiceManagement.tsx"));
const ShopDashboard = lazy(() => import("./pages/ShopDashboard.tsx"));
const ShopDetails = lazy(() => import("./pages/ShopDetails.tsx"));
const ShopMap = lazy(() => import("./pages/ShopMap.tsx"));
const ShopProfile = lazy(() => import("./pages/ShopProfile.tsx"));
const StaffManagement = lazy(() => import("./pages/StaffManagement.tsx"));
const StaffRegistration = lazy(() => import("./pages/StaffRegistration.tsx"));

export const userRoutes: RouteObject[] = [

	{ path: "/", element: <App />},
	{ path: "/book-appointment", element: <BookAppointment />},
	{ path: "/bookappointment", element: <BookAppointment />},
	{ path: "/code-health", element: <UserGuard><CodeHealth /></UserGuard>},
	{ path: "/codehealth", element: <UserGuard><CodeHealth /></UserGuard>},
	{ path: "/customer-dashboard", element: <UserGuard><CustomerDashboard /></UserGuard>},
	{ path: "/customerdashboard", element: <UserGuard><CustomerDashboard /></UserGuard>},
	{ path: "/customer-profile", element: <UserGuard><CustomerProfile /></UserGuard>},
	{ path: "/customerprofile", element: <UserGuard><CustomerProfile /></UserGuard>},
	{ path: "/employee-dashboard", element: <UserGuard><EmployeeDashboard /></UserGuard>},
	{ path: "/employeedashboard", element: <UserGuard><EmployeeDashboard /></UserGuard>},
	{ path: "/features", element: <Features />},
	{ path: "/join-queue", element: <RedirectKeepQuery to="/public-join-queue" />},
	{ path: "/joinqueue", element: <RedirectKeepQuery to="/public-join-queue" />},
	{ path: "/join-queue-refactored", element: <RedirectKeepQuery to="/public-join-queue" />},
	{ path: "/joinqueuerefactored", element: <RedirectKeepQuery to="/public-join-queue" />},
	{ path: "/login", element: <Login />},
	{ path: "/logout", element: <UserGuard><Logout /></UserGuard>},
	{ path: "/my-bookings", element: <UserGuard><MyBookings /></UserGuard>},
	{ path: "/mybookings", element: <UserGuard><MyBookings /></UserGuard>},
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
	{ path: "/shopprofile", element: <UserGuard><ShopProfile /></UserGuard>},
	{ path: "/staff-management", element: <UserGuard><StaffManagement /></UserGuard>},
	{ path: "/staffmanagement", element: <UserGuard><StaffManagement /></UserGuard>},
	{ path: "/staff-registration", element: <StaffRegistration />},
	{ path: "/staffregistration", element: <StaffRegistration />},

];
