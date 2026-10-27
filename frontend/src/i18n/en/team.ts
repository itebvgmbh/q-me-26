import type { Texte } from "../typen.ts";

// Team, Arbeitszeiten, Leistungen, Pausen, Auswertung
const texte: Texte = {
  // pages/StaffManagement.tsx
  "Das Team konnte nicht geladen werden.": "Couldn't load the team.",
  "Deine Läden konnten nicht geladen werden.": "Couldn't load your shops.",
  "{name} ist wieder im Team.": "{name} is back in the team.",
  "Zurückholen hat nicht geklappt. Bitte noch einmal.": "Couldn't restore. Please try again.",
  "Wer arbeitet wann und bietet was an. Nur so entstehen freie Zeiten.": "Who works when and offers what. That's the only way free slots appear.",
  "Im Tarif {tarif} sind {n} Personen dabei.": { one: "The {tarif} plan includes one person.", other: "The {tarif} plan includes {n} people." },
  "Tarif wechseln": "Change plan",
  "Laden wählen": "Choose shop",
  "Team wird geladen": "Loading team",
  "Richte zuerst deinen Laden ein.": "Set up your shop first.",
  "Laden einrichten": "Set up shop",
  "Noch niemand im Team.": "No one in the team yet.",
  "Arbeitest du selbst mit, leg dich mit deiner E-Mail als erste Person an. Mitarbeiter lädst du mit „Per E-Mail einladen“ ein, oder du legst sie an und schickst ihnen danach den Link, z. B. per WhatsApp.":
    "If you work in the shop yourself, add yourself first with your email. Invite staff with “Invite by email”, or add them and then send them the link, e.g. via WhatsApp.",
  "Deaktiviert ({anzahl})": "Deactivated ({anzahl})",
  "Bei diesen Personen kann niemand buchen, und sie sehen „Mein Tag“ nicht. Zurückgeholt ist alles wieder wie vorher.":
    "No one can book with these people, and they can't see “My day”. Once restored, everything is as it was.",
  "Zurückholen": "Restore",
  "Dein Tarif ist voll. Deaktiviere erst jemand anderen oder <tarif>wechsle den Tarif</tarif>.": "Your plan is full. Deactivate someone else first or <tarif>change your plan</tarif>.",

  // pages/StaffRegistration.tsx
  "In diesem Link fehlt etwas. Bitte deinen Laden, ihn noch einmal zu schicken.": "Something is missing from this link. Ask your shop to send it again.",
  "Willkommen im Team von {laden}!": "Welcome to the team at {laden}!",
  "Das hat nicht geklappt.": "That didn't work.",
  "Mit dieser E-Mail gibt es schon ein Konto. Melde dich damit an, dann nimmst du die Einladung an.": "There's already an account with this email. Sign in with it to accept the invitation.",
  "Dieser Link klappt nicht.": "This link doesn't work.",
  "Zur Startseite": "Go to home page",
  "Einladung wird geprüft …": "Checking invitation …",
  "Die Einladung gilt nicht mehr.": "This invitation has expired.",
  "Bitte {laden} um einen neuen Link. Im Team unter „Bearbeiten“ geht das in einer Minute.": "Ask {laden} for a new link. It takes a minute under “Edit” in the team.",
  "Schon angenommen.": "Already accepted.",
  "Diese Einladung ist schon mit einem Konto verbunden. Melde dich damit an, dann siehst du deinen Tag bei {laden}.":
    "This invitation is already linked to an account. Sign in with it to see your day at {laden}.",
  "Zu Mein Tag": "Go to My day",
  "Willkommen im Team von {laden}.": "Welcome to the team at {laden}.",
  "So arbeitest du mit Dranzeit": "How to work with Dranzeit",
  "{laden} hat dich als {name} ins Team eingeladen. Nimm die Einladung mit deinem Konto an, dann siehst du unter „Mein Tag“ deine Kunden.":
    "{laden} has invited you to the team as {name}. Accept the invitation with your account and you'll see your customers under “My day”.",
  "{laden} hat dich ins Team eingeladen. Nimm die Einladung mit deinem Konto an, dann siehst du unter „Mein Tag“ deine Kunden.":
    "{laden} has invited you to the team. Accept the invitation with your account and you'll see your customers under “My day”.",
  "Nicht dein Konto?": "Not your account?",
  "Angemeldet als <konto>{email}</konto>": "Signed in as <konto>{email}</konto>",
  "Wird angenommen …": "Accepting …",
  "Einladung annehmen": "Accept invitation",
  "{laden} hat dich als {name} ins Team eingeladen. Leg dein Konto an, danach siehst du unter „Mein Tag“ deine Kunden.":
    "{laden} has invited you to the team as {name}. Create your account and you'll then see your customers under “My day”.",
  "{laden} hat dich ins Team eingeladen. Leg dein Konto an, danach siehst du unter „Mein Tag“ deine Kunden.":
    "{laden} has invited you to the team. Create your account and you'll then see your customers under “My day”.",
  "Schon ein Konto bei Dranzeit?": "Already have a Dranzeit account?",
  "Anmelden und annehmen": "Sign in and accept",
  "Wird angelegt …": "Creating …",
  "Konto anlegen": "Create account",

  // components/AddStaffDialog.tsx
  "Fehler beim Hochladen des Profilbilds": "Couldn't upload the profile picture",
  "Bitte trag einen Namen ein.": "Please enter a name.",
  "Die E-Mail stimmt nicht. Bitte prüf sie noch einmal.": "That email doesn't look right. Please check it.",
  "Du bist jetzt im Team und siehst deine Termine unter „Mein Tag“.": "You're now in the team and can see your appointments under “My day”.",
  "Anlegen hat nicht geklappt. Bitte noch einmal.": "Couldn't add. Please try again.",
  "Person anlegen": "Add person",
  "{name} ist im Team.": "{name} is in the team.",
  "Soll {name} den eigenen Tag sehen? Dann schick eine Einladung. Sonst tipp auf „Fertig“, einladen geht auch später unter „Bearbeiten“.":
    "Should {name} see their own day? Then send an invitation. Otherwise tap “Done” – you can also invite them later under “Edit”.",
  "Für dich selbst (mit deiner E-Mail) oder jemanden aus dem Team. Danach kannst du die Person per Link oder E-Mail einladen.":
    "For yourself (with your email) or someone in the team. Afterwards you can invite them by link or email.",
  "Name": "Name",
  "Max Mustermann": "Alex Smith",
  "E-Mail (freiwillig, für die Einladung)": "Email (optional, for the invitation)",
  "Telefon (freiwillig)": "Phone (optional)",
  "Aufgabe (freiwillig)": "Role (optional)",
  "z. B. Friseurin": "e.g. Hairdresser",
  "{dauer} Min. | {preis} €": "{dauer} min | €{preis}",
  "Arbeitszeiten": "Working hours",
  "bis": "to",
  "Anlegen": "Add",

  // components/EditStaffDialog.tsx
  "Gespeichert.": "Saved.",
  "Speichern hat nicht geklappt. Bitte noch einmal.": "Couldn't save. Please try again.",
  "{name} bearbeiten": "Edit {name}",
  "Leistungen, Arbeitszeiten und Kontakt. Hat die Person noch kein Konto, lädst du sie hier ein.":
    "Services, working hours and contact details. If the person doesn't have an account yet, invite them here.",
  "Profil": "Profile",
  "Einzelne Pausen": "One-off breaks",
  "Wöchentliche Pausen": "Weekly breaks",
  "Profilbild": "Profile picture",
  "{name} Profilbild": "Profile picture of {name}",
  "Einladung": "Invitation",
  "Änderungen speichern": "Save changes",
  "Gilt nur an einem bestimmten Tag, z. B. für einen Arzttermin. Für jede Woche gleich: „Wöchentliche Pausen“. Die Mittagspause des ganzen Ladens steht bei den Öffnungszeiten.":
    "Only applies on a specific day, e.g. for a doctor's appointment. The same every week: “Weekly breaks”. The lunch break for the whole shop is set in the opening hours.",
  "Jede Woche zur selben Zeit, z. B. dienstags 12–13 Uhr. In dieser Zeit bekommt die Person keine Kunden.":
    "Every week at the same time, e.g. Tuesdays 12:00–13:00. During this time the person gets no customers.",

  // components/InviteStaffDialog.tsx
  "Bitte trag einen Namen ein. So sehen Kunden die Person bei der Buchung.": "Please enter a name. That's how customers see the person when booking.",
  "Per E-Mail einladen": "Invite by email",
  "Die Einladung ist an {email} unterwegs.": "The invitation is on its way to {email}.",
  "Die Einladung ist noch nicht angekommen. Unten steht, was du tun kannst.": "The invitation hasn't arrived yet. See below for what you can do.",
  "Leistungen und Arbeitszeiten passt du unter „Bearbeiten“ an.": "You can adjust services and working hours under “Edit”.",
  "Die Einladung konnte nicht erstellt werden. Versuch es unten noch einmal.": "The invitation couldn't be created. Try again below.",
  "Die Person steht sofort im Team und bekommt einen Link. Damit legt sie ihr Konto an (oder meldet sich mit ihrem an) und sieht unter „Mein Tag“ ihre Kunden.":
    "The person joins the team straight away and gets a link. With it they create their account (or sign in with theirs) and see their customers under “My day”.",
  "E-Mail": "Email",
  "Wird verschickt …": "Sending …",
  "Einladung senden": "Send invitation",

  // components/StaffInvitePanel.tsx
  "Hat ein Konto und sieht „Mein Tag“.": "Has an account and sees “My day”.",
  "Einladung an {email} verschickt.": "Invitation sent to {email}.",
  "Die E-Mail ging nicht raus. Schick den Link selbst.": "The email wasn't sent. Send the link yourself.",
  "Einladungslink erstellt.": "Invitation link created.",
  "Link kopiert.": "Link copied.",
  "Kopieren ging nicht. Markier den Link und kopier ihn von Hand.": "Couldn't copy. Select the link and copy it manually.",
  "Einladung ins Team": "Invitation to the team",
  "Damit siehst du deinen Tag bei Dranzeit:": "Use this to see your day on Dranzeit:",
  "Die Einladung vom {datum} ist abgelaufen.": "The invitation from {datum} has expired.",
  "Eingeladen am {datum} per E-Mail an {email}, gilt bis {bis}. Noch nicht angenommen.": "Invited on {datum} by email to {email}, valid until {bis}. Not accepted yet.",
  "Eingeladen am {datum}, gilt bis {bis}. Noch nicht angenommen.": "Invited on {datum}, valid until {bis}. Not accepted yet.",
  "Mit dem Link legt die Person ihr Konto an (oder meldet sich mit ihrem an) und sieht danach unter „Mein Tag“ ihre Kunden.":
    "With the link, the person creates their account (or signs in with theirs) and then sees their customers under “My day”.",
  "E-Mail an {email} ist verschickt. Du kannst den Link auch selbst weitergeben:": "Email to {email} has been sent. You can also share the link yourself:",
  "Schick {name} den Link selbst, z. B. per WhatsApp oder SMS:": "Send {name} the link yourself, e.g. via WhatsApp or text message:",
  "Schick {name} diesen Link, z. B. per WhatsApp oder SMS:": "Send {name} this link, e.g. via WhatsApp or text message:",
  "Link kopieren": "Copy link",
  "Teilen": "Share",
  "Wird erstellt …": "Creating …",
  "Neuen Link erstellen": "Create new link",
  "Einladungslink erstellen": "Create invitation link",
  "Neu per E-Mail schicken": "Resend by email",
  "Per E-Mail schicken": "Send by email",
  "Speichere zuerst die geänderte E-Mail. Die Einladung geht an die gespeicherte Adresse.": "Save the changed email first. The invitation goes to the saved address.",
  "Für die E-Mail trag eine Adresse ein und speichere. Den Link kannst du auch ohne weitergeben.": "To send by email, enter an address and save. You can share the link without one.",
  "Ein neuer Link ersetzt den alten, der alte gilt dann nicht mehr. Jeder Link gilt 14 Tage.": "A new link replaces the old one, which then stops working. Each link is valid for 14 days.",
  "Der Link gilt 14 Tage.": "The link is valid for 14 days.",

  // components/StaffCard.tsx
  "Hat Zugang": "Has access",
  "Eingeladen": "Invited",
  "{name} ist deaktiviert.": "{name} is deactivated.",
  "Deaktivieren hat nicht geklappt.": "Couldn't deactivate.",
  "{n} Tage pro Woche": { one: "{n} day a week", other: "{n} days a week" },
  "keine Arbeitszeiten": "no working hours",
  "Keine Leistung zugeordnet – taucht bei der Buchung nicht auf.": "No service assigned – won't appear when booking.",
  "Deaktivieren": "Deactivate",
  "{name} deaktivieren?": "Deactivate {name}?",
  "Für {name} kann dann niemand mehr buchen, bestehende Termine bleiben.": "No one will be able to book with {name} any more; existing appointments stay.",
  "{name} sieht „Mein Tag“ nicht mehr.": "{name} will no longer see “My day”.",
  "Unter „Deaktiviert“ holst du die Person jederzeit zurück.": "You can restore the person at any time under “Deactivated”.",

  // components/WorkingHoursForm.tsx, utils/staff-utils.ts, components/RecurringBreakManager.tsx (Wochentage)
  "Sonntag": "Sunday",
  "Montag": "Monday",
  "Dienstag": "Tuesday",
  "Mittwoch": "Wednesday",
  "Donnerstag": "Thursday",
  "Freitag": "Friday",
  "Samstag": "Saturday",
  "Arbeitszeiten erfolgreich aktualisiert": "Working hours updated",
  "Fehler beim Aktualisieren: {fehler}": "Couldn't update: {fehler}",
  "Unbekannter Fehler": "Unknown error",
  "Von": "From",
  "Bis": "To",
  "Speichern...": "Saving...",

  // pages/ServiceManagement.tsx
  "Was man bei {laden} buchen kann – mit Dauer und Preis.": "What people can book at {laden} – with duration and price.",
  "Was man bei dir buchen kann – mit Dauer und Preis.": "What people can book with you – with duration and price.",
  "Leistungen werden geladen": "Loading services",
  "Deine Läden konnten nicht geladen werden. Bitte lade die Seite neu.": "Couldn't load your shops. Please reload the page.",

  // components/ServiceDialogs.tsx
  "Leistung angelegt.": "Service added.",
  "Die Leistung konnte nicht angelegt werden.": "Couldn't add the service.",
  "Leistung anlegen": "Add service",
  "Neue Leistung": "New service",
  "Was kann man bei dir buchen? Dauer und Preis bestimmen die freien Zeiten.": "What can people book with you? Duration and price determine the free slots.",
  "Leistung gespeichert.": "Service saved.",
  "Die Leistung konnte nicht gespeichert werden.": "Couldn't save the service.",
  "Leistung bearbeiten": "Edit service",
  "Änderungen gelten für neue Buchungen.": "Changes apply to new bookings.",
  "„{name}“ ist gelöscht.": "“{name}” has been deleted.",
  "Rückgängig": "Undo",
  "Löschen hat nicht geklappt.": "Couldn't delete.",
  "„{name}“ löschen?": "Delete “{name}”?",
  "Kunden können die Leistung dann nicht mehr buchen, und sie verschwindet bei den Personen im Team.":
    "Customers will no longer be able to book this service, and it will be removed from the team members.",
  "Termine, die schon gebucht sind, bleiben.": "Appointments already booked will stay.",
  "Es ist kein kommender Termin damit gebucht.": "There are no upcoming appointments with it.",
  "{n} kommende Termine sind damit gebucht. Sie bleiben bestehen.": {
    one: "One upcoming appointment is booked with it. It will stay.",
    other: "{n} upcoming appointments are booked with it. They will stay.",
  },
  "Unter „Gelöschte Leistungen“ kannst du sie jederzeit zurückholen.": "You can restore it at any time under “Deleted services”.",

  // components/ServiceForm.tsx
  "Name ist erforderlich": "Name is required",
  "Dauer ist erforderlich": "Duration is required",
  "Dauer muss eine positive Zahl sein": "Duration must be a positive number",
  "Preis ist erforderlich": "Price is required",
  "Preis muss eine nicht-negative Zahl sein": "Price can't be negative",
  "Vor- und Nachbereitung muss 0 oder mehr Minuten sein": "Preparation and clean-up must be 0 minutes or more",
  "z.B. Haarschnitt": "e.g. Haircut",
  "Beschreibung": "Description",
  "z. B. Waschen, Schneiden, Föhnen": "e.g. Wash, cut, blow-dry",
  "Dauer (Minuten)": "Duration (minutes)",
  "Vor- und Nachbereitung (Minuten)": "Preparation and clean-up (minutes)",
  "Zeit zum Aufräumen und Vorbereiten. Bei Nummern und Online-Terminen wird sie zur Dauer dazugerechnet, damit zwischen zwei Kunden Luft bleibt.":
    "Time for tidying up and getting ready. For queue numbers and online appointments it is added to the duration, so there's breathing room between two customers.",
  "Preis (€)": "Price (€)",
  "Kategorie": "Category",
  "z.B. Haare": "e.g. Hair",
  "Wird gespeichert...": "Saving...",

  // components/ServicesList.tsx
  "„{name}“ ist wieder buchbar.": "“{name}” can be booked again.",
  "Zurückholen hat nicht geklappt.": "Couldn't restore.",
  "Noch keine Leistung.": "No services yet.",
  "Leg mindestens eine an, zum Beispiel „Haarschnitt, 30 Minuten“. Ohne Leistung kann niemand buchen.":
    "Add at least one, for example “Haircut, 30 minutes”. Without a service, no one can book.",
  "{dauer} Min + {vorbereitung} Vor-/Nachbereitung": "{dauer} min + {vorbereitung} prep/clean-up",
  "{dauer} Min": "{dauer} min",
  "Gelöschte Leistungen ({anzahl})": "Deleted services ({anzahl})",
  "Nicht mehr buchbar. Termine, die schon damit gebucht waren, behalten sie.": "No longer bookable. Appointments already booked with them keep them.",

  // components/BreakManager.tsx
  "Mittagspause": "Lunch break",
  "Kaffeepause": "Coffee break",
  "Persönliche Pause": "Personal break",
  "Sonstige Pause": "Other break",
  "Fehler beim Laden der Pausen": "Couldn't load breaks",
  "Pause erfolgreich gelöscht": "Break deleted",
  "Fehler beim Löschen der Pause": "Couldn't delete the break",
  "Bitte Start- und Endzeit auswählen": "Please choose a start and end time",
  "Die Endzeit muss nach der Startzeit liegen": "The end time must be after the start time",
  "Diese Pause überschneidet sich mit einer bestehenden Pause": "This break overlaps with an existing break",
  "Pause erfolgreich aktualisiert": "Break updated",
  "Pause erfolgreich erstellt": "Break created",
  "Fehler beim Speichern der Pause": "Couldn't save the break",
  "Pausenverwaltung für {name}": "Breaks for {name}",
  "Datum": "Date",
  "Datum auswählen": "Choose date",
  "Neue Pause hinzufügen": "Add new break",
  "Pause bearbeiten": "Edit break",
  "Startzeit": "Start time",
  "Endzeit": "End time",
  "Pausentyp": "Break type",
  "Pausentyp auswählen": "Choose break type",
  "Pausen am {datum}": "Breaks on {datum}",
  "Lädt...": "Loading...",
  "Keine Pausen für diesen Tag eingetragen.": "No breaks entered for this day.",
  "Pause": "Break",
  "{start} - {ende} Uhr": "{start} - {ende}",

  // components/RecurringBreakManager.tsx
  "Persönlich": "Personal",
  "Sonstige": "Other",
  "Fehler beim Laden der wiederkehrenden Pausen": "Couldn't load recurring breaks",
  "Diese Pause wirklich löschen?": "Really delete this break?",
  "Pause aktiviert": "Break switched on",
  "Pause deaktiviert": "Break switched off",
  "Fehler beim Ändern des Pausenstatus": "Couldn't change the break status",
  "Bitte gib Start- und Endzeit ein.": "Please enter a start and end time.",
  "Die Startzeit muss vor der Endzeit liegen": "The start time must be before the end time",
  "Diese Pause überschneidet sich mit einer bereits existierenden Pause": "This break overlaps with an existing break",
  "Wöchentliche Pausen für {name}": "Weekly breaks for {name}",
  "Regelmäßige Pausen – in dieser Zeit kann niemand buchen.": "Regular breaks – no one can book during this time.",
  "Pausen für {tag}": "Breaks on {tag}",
  "Pause hinzufügen": "Add break",
  "Keine Pausen für diesen Tag eingerichtet.": "No breaks set up for this day.",

  // pages/Auswertung.tsx
  "7 Tage": "7 days",
  "30 Tage": "30 days",
  "Auswertung wird geladen …": "Loading statistics …",
  "Auswertung": "Statistics",
  "Wie viele Kunden kommen, wie lange sie warten und wann am meisten los ist: Das gehört zum Tarif Laden.":
    "How many customers come, how long they wait and when it's busiest: that's part of the “Laden” plan.",
  "Tarif ansehen": "View plan",
  "Zeitraum": "Period",
  "Auswertung wird berechnet": "Calculating statistics",
  "Kunden": "Customers",
  "Davon per Nummer": "Via queue number",
  "{prozent} %": "{prozent}%",
  "Ø Wartezeit (Nummer)": "Avg. wait (queue number)",
  "{minuten} Min.": "{minuten} min",
  "erst ab Aufruf am Tresen messbar": "only measurable once called at the front desk",
  "aus {n} Nummern": { one: "from {n} number", other: "from {n} numbers" },
  "Abgesagt": "Cancelled",
  "Umsatz (erledigt)": "Revenue (completed)",
  "Kunden pro Tag": "Customers per day",
  "Nummer": "Number",
  "Termin": "Appointment",
  "{tag}: {nummern} Nummern, {termine} Termine": "{tag} – numbers: {nummern}, appointments: {termine}",
  "Stoßzeiten": "Peak times",
  "Am meisten los ist zwischen {von} und {bis} Uhr.": "It's busiest between {von}:00 and {bis}:00.",
  "{stunde} Uhr: {anzahl}": "{stunde}:00 – {anzahl}",

  // utils/stats.ts (date-fns)
  "EEEEEE d.M.": "EEEEEE d/M",

  // utils/firestore/staff.ts
  "{name} mit dieser E-Mail ist deaktiviert. Hol sie unten unter „Deaktiviert“ zurück ins Team.":
    "{name} with this email is deactivated. Bring them back into the team below under “Deactivated”.",
  "{name} hat diese E-Mail schon im Team.": "{name} already uses this email in the team.",

  // utils/hooks/useServiceManagement.ts
  "Fehler beim Laden der Services": "Error loading services",
  "Kein Shop ausgewählt": "No shop selected",
  "Service erfolgreich erstellt": "Service created",
  "Fehler beim Erstellen des Services": "Couldn't create the service",
  "Service erfolgreich aktualisiert": "Service updated",
  "Fehler beim Aktualisieren des Services": "Couldn't update the service",

  // utils/hooks/useStaff.ts, utils/hooks/useStaffData.ts
  "Fehler beim Laden der Mitarbeiter": "Error loading staff",

  // utils/staff-invitation.ts
  "Keine Verbindung zum Server. Bitte prüf dein Internet.": "No connection to the server. Please check your internet connection.",
  "Das hat nicht geklappt (Fehler {status}).": "That didn't work (error {status}).",
};

export default texte;
