import { useUserGuardContext } from 'app';
import { Navigation } from '../components/Navigation';
import { ProfileForm } from '../components/ProfileForm';

const Profile = () => {
  const { user } = useUserGuardContext();

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <div className="container mx-auto max-w-2xl py-12">
        <h1 className="text-3xl font-bold mb-8">Profil bearbeiten</h1>
        <div className="bg-white rounded-lg shadow p-6">
          <ProfileForm userId={user.uid} />
        </div>
      </div>
    </div>
  );
};

export default Profile;
