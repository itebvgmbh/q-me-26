import { Link, useLocation } from 'react-router-dom';
import { t, tTeile } from '@/i18n';
import { ROLE_CHOICES, RoleChoiceCard } from '../components/auth/RoleChoice';

const TARGET = { customer: '/register-customer', shopOwner: '/register-shop-owner' } as const;

/** Auswahl vor der Registrierung: buchen oder Laden */
const RegisterOptions = () => {
  const { search, state } = useLocation();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:py-16">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em] sm:text-5xl">{t('Wofür brauchst du Dranzeit?')}</h1>
        <p className="text-muted-foreground">{t('Zum Einreihen brauchst du kein Konto. Mit Konto behältst du deine Nummern und Termine im Blick.')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {ROLE_CHOICES.map((choice, i) => (
          <Link key={choice.role} to={`${TARGET[choice.role]}${search}`} state={state} className="rounded-3xl">
            <RoleChoiceCard icon={choice.icon} title={t(choice.title)} text={t(choice.text)} as="span" dark={i === 0}>
              {choice.role === 'customer' ? t('Als Kunde registrieren') : t('Als Laden registrieren')}
            </RoleChoiceCard>
          </Link>
        ))}
      </div>

      <div className="flex flex-col gap-2 text-sm text-muted-foreground">
        <p>{t('Du arbeitest in einem Laden? Dann bekommst du von deiner Chefin oder deinem Chef einen Einladungslink.')}</p>
        <p>
          {tTeile('Schon ein Konto? <link>Anmelden</link>', {
            link: (inhalt) => (
              <Link to={`/login${search}`} state={state} className="font-semibold text-foreground underline-offset-4 hover:underline">
                {inhalt}
              </Link>
            ),
          })}
        </p>
      </div>
    </div>
  );
};

export default RegisterOptions;
