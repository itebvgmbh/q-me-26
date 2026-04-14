import { useEffect } from 'react';
import { APP_BASE_PATH } from 'app';

// This component is just a redirect to the new registration flow
const Register = () => {
  useEffect(() => {
    // Redirect to the new registration options page using APP_BASE_PATH
    window.location.href = `${window.location.origin}${APP_BASE_PATH}/register-options`;
  }, []);

  return null;
};

export default Register;