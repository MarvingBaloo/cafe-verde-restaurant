import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const DevRoute = ({ element }) => {
  const { user, isDev } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!isDev) return <Navigate to="/" replace />;
  return element;
};

export default DevRoute;
