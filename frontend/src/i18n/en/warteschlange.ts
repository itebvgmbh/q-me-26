import type { Texte } from "../typen.ts";

const texte: Texte = {
  // pages/Nummer.tsx
  "EEEEEE d.M.": "EEEEEE d/M",
  "EEEEEE d.M., HH:mm": "EEEEEE d/M, HH:mm",
  "Nummer {nummer} · Dranzeit": "Number {nummer} · Dranzeit",
  "Diese Nummer gibt es nicht.": "This number doesn't exist.",
  "Der Link ist unvollständig oder die Nummer wurde gelöscht.": "The link is incomplete or the number has been deleted.",
  "Deine Nummer wird geladen …": "Loading your number …",
  "Deine Nummer ist zurückgegeben.": "You've left the queue.",
  "Dein Termin ist abgesagt.": "Your appointment has been cancelled.",
  "Das hat nicht geklappt. Sag bitte am Tresen Bescheid.": "That didn't work. Please let the front desk know.",
  "Du bist eingereiht.": "You're in the queue.",
  "Deine Nummer": "Your number",
  "Dein Termin": "Your appointment",
  "Dein Platz hat sich auf {zeit} verschoben – jemand war kurz vor dir dran.": "Your slot has moved to {zeit} – someone got in just before you.",
  "Du bist dran. Komm rein.": "It's your turn. Come on in.",
  "Vor dir": "Ahead of you",
  "Wann": "When",
  "Dran um ca.": "Your turn approx.",
  "Um": "At",
  "Heute dauert es etwas länger: ursprünglich {zeit}, jetzt etwa {n} Minuten später.": {
    one: "It's taking a little longer today: originally {zeit}, now about {n} minute later.",
    other: "It's taking a little longer today: originally {zeit}, now about {n} minutes later.",
  },
  "Der Laden hängt gerade etwa {n} Minuten hinterher. Rechne mit etwas Wartezeit.": {
    one: "The shop is running about {n} minute behind. Expect a short wait.",
    other: "The shop is running about {n} minutes behind. Expect a short wait.",
  },
  "Fertig. Danke für deinen Besuch!": "All done. Thanks for your visit!",
  "Diese Nummer ist abgesagt.": "This number has been cancelled.",
  "Dieser Termin ist abgesagt.": "This appointment has been cancelled.",
  "Diese Seite aktualisiert sich von selbst. Du kannst sie schließen und über den Link oder die Startseite wieder öffnen.":
    "This page updates by itself. You can close it and reopen it from the link or the home page.",
  "Früher dran, wenn etwas frei wird": "Earlier slot if one opens up",
  "Das geht mit Konto: Wird vorher ein Platz frei, bieten wir ihn dir an. Leg eins an – deine Nummer bleibt, und du kannst es gleich hier einschalten.":
    "This needs an account: if an earlier slot opens up, we'll offer it to you. Create one – you keep your number and can switch this on right here.",
  "Konto anlegen und Nummer behalten": "Create an account and keep the number",
  "Nummer zurückgeben": "Leave the queue",
  "Termin absagen": "Cancel appointment",
  "Ja, zurückgeben": "Yes, leave",
  "Ja, absagen": "Yes, cancel",
  "Zurückgeben geht auf dem Handy, mit dem du die Nummer gezogen hast, oder am Tresen.":
    "You can leave the queue on the phone you took the number with, or at the front desk.",
  "Absagen geht auf dem Handy, mit dem du gebucht hast, oder am Tresen.": "You can cancel on the phone you booked with, or at the front desk.",
  "Zum Absagen melde dich mit deinem Konto an – oder sag am Tresen Bescheid.": "To cancel, sign in to your account – or let the front desk know.",
  "Zum Laden": "Go to shop",
  "So funktioniert’s": "How it works",
  "Wirklich? Dein Platz wird dann frei.": "Are you sure? Your slot will go to someone else.",
  "Behalten": "Keep",
  "Wir sagen dir Bescheid, kurz bevor du dran bist.": "We'll let you know shortly before it's your turn.",
  "Benachrichtigungen sind für diese Seite blockiert. Du kannst sie in den Browser-Einstellungen erlauben.":
    "Notifications are blocked for this page. You can allow them in your browser settings.",
  "Dein Browser kann keine Benachrichtigungen. Nimm die E-Mail.": "Your browser can't show notifications. Use e-mail instead.",
  "Das hat nicht geklappt.": "That didn't work.",
  "Wir schicken dir eine E-Mail, kurz bevor du dran bist.": "We'll e-mail you shortly before it's your turn.",
  "Bescheid bekommen": "Get notified",
  "Wir melden uns, kurz bevor du dran bist. Bis dahin bist du frei.": "We'll get in touch shortly before your turn. Until then, you're free to go.",
  "Benachrichtigung ist an.": "Notifications are on.",
  "Benachrichtigung einschalten": "Turn on notifications",
  "Auf dem iPhone kommen Benachrichtigungen im Browser nicht an. Trag hier deine E-Mail ein, dann sagen wir dir per Mail Bescheid.":
    "On iPhone, browser notifications don't come through. Enter your e-mail here and we'll let you know by e-mail.",
  "Oder per E-Mail": "Or by e-mail",
  "Per E-Mail": "By e-mail",
  "du@beispiel.de": "you@example.com",
  "Ändern": "Change",
  "E-Mail ist hinterlegt.": "E-mail saved.",
  "Nur für diese Nummer. Wir löschen die Adresse spätestens 90 Tage nach dem Termin.":
    "Only for this number. We delete the address no later than 90 days after the appointment.",

  // pages/PublicJoinQueue.tsx
  "Die Zeit ist schon vorbei. Wir suchen dir den nächsten Platz – bitte gleich noch mal bestätigen.":
    "That time has already passed. We're finding you the next slot – please confirm again in a moment.",
  "Einen Moment – wir holen die Läden …": "One moment – loading the shops …",
  "Einen Moment – wir holen die Leistungen …": "One moment – loading the services …",
  "Dieser Laden nimmt gerade keine Nummern an.": "This shop isn't taking numbers right now.",
  "Online geht im Moment weder Nummer ziehen noch Termin buchen.": "Taking a number or booking online isn't possible at the moment.",
  "Wir suchen dir den nächsten freien Platz. Fester Wunschtermin? <buchen>Termin buchen</buchen>":
    "We'll find you the next free slot. Want a fixed time? <buchen>Book an appointment</buchen>",
  "Laden": "Shop",
  "Leistung": "Service",
  "Person": "Team member",
  "Bestätigen": "Confirm",

  // pages/Bildschirm.tsx
  "Diesen Laden gibt es nicht.": "This shop doesn't exist.",
  "Prüf den Link zum Bildschirm am Tresen.": "Check the display link in the front desk view.",
  "Dieser Laden ist gerade gesperrt.": "This shop is currently suspended.",
  "Fragen beantworten wir unter {mail}.": "For questions, write to {mail}.",
  "Der Wartezimmer-Bildschirm gehört zum Tarif Laden.": "The waiting-room display is part of the Shop plan.",
  "Unter „Tarif“ lässt er sich freischalten.": "You can unlock it under “Plan”.",
  "Gerade wartet niemand.": "Nobody is waiting right now.",
  "Jetzt dran": "Now serving",
  "Als Nächstes": "Up next",
  "ca. {zeit}": "approx. {zeit}",
  "frei": "free",
  "+ {anzahl} weitere": "+ {anzahl} more",
  "Nummer ziehen ohne App": "Take a number – no app needed",
  "Scannen, Leistung wählen, draußen warten. Auf dem Handy siehst du, wann du dran bist.":
    "Scan, choose a service, wait outside. Your phone shows you when it's your turn.",
  "Keine Wartenden": "No one waiting",
  "{n} Personen warten": { one: "{n} person waiting", other: "{n} people waiting" },

  // pages/Plakat.tsx
  "QR-Code scannen": "Scan the QR code",
  "Leistung wählen, Nummer ziehen": "Choose a service, take a number",
  "Draußen warten. Auf dem Handy siehst du, wann du dran bist.": "Wait outside. Your phone shows you when it's your turn.",
  "Plakat wird vorbereitet …": "Preparing the poster …",
  "Richte zuerst deinen Laden ein.": "Set up your shop first.",
  "QR-Plakat": "QR poster",
  "Auf A4 drucken und an Tür oder Tresen hängen.": "Print on A4 and put it up on the door or counter.",
  "Tipps fürs Aufhängen": "Tips for putting it up",
  "Laden wählen": "Choose shop",
  "Drucken": "Print",
  "Nummer ziehen.": "Take a number.",
  "Ohne App.": "No app needed.",

  // components/QueueConfirmationStep.tsx
  "Passt das so?": "Does this look right?",
  "Andere Person wählen": "Choose someone else",
  "Du bist dran um ca.": "Your turn at approx.",
  "Wir suchen deinen Platz …": "Finding your slot …",
  "Die freien Plätze konnten nicht geladen werden.": "Couldn't load the free slots.",
  "Noch mal suchen": "Search again",
  "Gerade ist kein Platz frei. Versuch eine andere Person oder Leistung.": "No slot is free right now. Try someone else or another service.",
  "Bei": "With",
  "Wie dürfen wir dich aufrufen?": "What name should we call you by?",
  "Vorname": "First name",
  "Handynummer <hinweis>(optional, damit der Laden dich erreicht)</hinweis>":
    "Mobile number <hinweis>(optional, so the shop can reach you)</hinweis>",
  "Wird vorher ein Platz frei, bieten wir ihn dir an. Dafür brauchst du ein Konto – ohne Konto ziehst du deine Nummer wie gewohnt.":
    "If an earlier slot opens up, we'll offer it to you. You need an account for this – without one, you take your number as usual.",
  "Konto anlegen": "Create account",
  "Wir bieten dir einen früheren Platz an. Deiner bleibt sicher, bis du zusagst.": "We'll offer you an earlier slot. Yours stays safe until you accept.",
  "Online sind bei {laden} gerade keine Nummern mehr frei. Frag bitte direkt im Laden.":
    "{laden} has no more numbers available online right now. Please ask in the shop.",
  "Online sind bei diesem Laden gerade keine Nummern mehr frei. Frag bitte direkt im Laden.":
    "This shop has no more numbers available online right now. Please ask in the shop.",
  "Wird eingereiht …": "Joining the queue …",

  // components/QueueServiceStep.tsx
  "{dauer} Min": "{dauer} min",
  "{preis} €": "€{preis}",
  "Was soll gemacht werden?": "What would you like done?",
  "bei <laden>{name}</laden>": "at <laden>{name}</laden>",
  "Auswahl zurücksetzen": "Reset selection",
  "Anderen Laden wählen": "Choose another shop",
  "Dieser Laden hat noch keine Leistungen eingetragen.": "This shop hasn't added any services yet.",

  // components/QueueStaffStep.tsx
  "Suche freie Zeiten …": "Searching for free times …",
  "Nächster Platz {platz}": "Next slot {platz}",
  "In den nächsten 2 Wochen nichts frei": "Nothing free in the next 2 weeks",
  "Nächste freie Person": "Next available person",
  "Nächster Platz {platz} bei {name}": "Next slot {platz} with {name}",
  "Bei wem?": "With whom?",
  "Am schnellsten geht’s mit der nächsten freien Person.": "It's quickest with the next available person.",
  "Andere Leistung wählen": "Choose another service",
  "Heute ist nichts mehr frei.": "Nothing more is free today.",
  "Du kannst trotzdem eine Nummer für den nächsten freien Platz ziehen.": "You can still take a number for the next free slot.",
  "Versuch es später noch einmal oder ruf im Laden an.": "Try again later or call the shop.",
  "Egal wer – Hauptsache schnell": "Anyone – as long as it's quick",
  "Am schnellsten": "Fastest",
  "Für diese Leistung ist niemand fest eingetragen.": "No one is assigned to this service.",

  // components/ShopSelectionStep.tsx
  "Wo möchtest du hin?": "Where would you like to go?",
  "Wähl den Laden, in dessen Schlange du dich einreihen willst.": "Choose the shop whose queue you'd like to join.",
  "Noch kein Laden eingetragen.": "No shops listed yet.",
  "Zur Startseite": "Go to home page",

  // components/StepIndicator.tsx
  "Fortschritt": "Progress",
  "Schritt {schritt}": "Step {schritt}",

  // components/queue/ActiveTicketBanner.tsx
  "Nummer {nummer} ist noch offen. Zur Nummer": "Number {nummer} is still active. Show number",
  "Deine Nummer ist noch offen. Zur Nummer": "Your number is still active. Show number",

  // components/queue/SlotStatus.tsx
  "EEEE, d. MMMM": "EEEE, d MMMM",

  // components/FrueherDranSchalter.tsx
  "Früher dran ist an. Wird ein Platz frei, bekommst du ein Angebot.": "“Earlier slot” is on. If a slot opens up, you'll get an offer.",
  "Früher dran ist aus.": "“Earlier slot” is off.",
  "Das hat nicht geklappt. Versuch es noch einmal.": "That didn't work. Please try again.",
  "Ist an. Wird vorher ein Platz frei, bieten wir ihn dir an – annehmen unter <termine>Meine Termine</termine>. Deine Nummer bleibt sicher, bis du zusagst.":
    "On. If an earlier slot opens up, we'll offer it to you – accept it under <termine>My appointments</termine>. Your number stays safe until you accept.",
  "Wir bieten dir einen früheren Platz an, wenn einer frei wird. Deine Nummer bleibt sicher, bis du zusagst.":
    "We'll offer you an earlier slot if one opens up. Your number stays safe until you accept.",

  // components/QRCodeDisplay.tsx
  "Link kopiert.": "Link copied.",
  "Kopieren ging nicht. Halte den Link gedrückt und kopier ihn von Hand.": "Couldn't copy. Press and hold the link to copy it manually.",
  "Ausdrucken und an Tür oder Tresen hängen. Kunden scannen und ziehen eine Nummer – ohne App.":
    "Print it and put it up on the door or counter. Customers scan it and take a number – no app needed.",
  "QR-Code zum Einreihen bei {laden}": "QR code to join the queue at {laden}",
  "QR-Code zum Einreihen bei deinem Laden": "QR code to join the queue at your shop",
  "Link kopieren": "Copy link",
  "So sieht’s der Kunde": "See the customer view",

  // components/ConnectionProblem.tsx
  "Keine Verbindung zur Datenbank.": "No connection to the database.",
  "Das liegt meist am WLAN. Schalt es kurz aus und versuch’s mit mobilen Daten.":
    "This is usually down to the Wi-Fi. Turn it off for a moment and try mobile data.",
  "Noch mal versuchen": "Try again",
  "Technisch: {details}": "Technical: {details}",

  // utils/QueueBookingService.ts, utils/push.ts
  "Das hat nicht geklappt. Versuch es gleich noch einmal.": "That didn't work. Please try again in a moment.",
  "Du stehst schon in der Schlange dieses Ladens.": "You're already in this shop's queue.",
  "Du bist eingereiht": "You're in the queue",
  "Termin erfolgreich gebucht!": "Appointment booked!",

  // utils/frueher-dran.ts, utils/ticket-key.ts
  "Keine Verbindung zum Server. Bitte prüf dein Internet.": "No connection to the server. Please check your internet connection.",
  "Das hat nicht geklappt (Fehler {status}).": "That didn't work (error {status}).",

  // utils/notifications.ts
  "{n} frühere Plätze sind frei geworden.": { one: "An earlier slot has opened up.", other: "{n} earlier slots have opened up." },

  // Zeitfenster und Regel bei Verspätung (pages/Nummer.tsx, components/QueueConfirmationStep.tsx)
  "Rechne mit {von} bis {bis} Uhr.": "Expect your turn between {von} and {bis}.",
  "Bist du beim Aufruf nicht da, kann der Laden deine Nummer austragen.": "If you're not there when your number is called, the shop may remove it.",
};

export default texte;
