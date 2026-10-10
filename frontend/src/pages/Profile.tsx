import { useUserGuardContext } from 'app';
import { ProfileForm } from '../components/ProfileForm';

/** Mein Profil – für alle Rollen dasselbe Formular */
const Profile = () => {
  const { user } = useUserGuardContext();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">Mein Profil</h1>
      <ProfileForm userId={user.uid} />
    </div>
  );
};

export default Profile;
