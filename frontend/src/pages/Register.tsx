import { Navigate, useLocation } from 'react-router-dom';

// Alte Adresse: weiter zur Auswahl Kunde/Betrieb
const Register = () => {
  const { search, state } = useLocation();
  return <Navigate to={`/register-options${search}`} state={state} replace />;
};

export default Register;
