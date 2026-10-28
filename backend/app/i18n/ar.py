"""Arabisch (Du-Form wie im Frontend, von rechts nach links; Ziffern bleiben westlich wie auf Nummer und Bildschirm).
Schlüssel ist der deutsche Text aus dem Code; geprüft in tests/test_i18n.py."""

TEXTE: dict = {
    # Wochentage, Tage (app/i18n, app/libs/queue_notify.py)
    "Mo": "الاثنين",
    "Di": "الثلاثاء",
    "Mi": "الأربعاء",
    "Do": "الخميس",
    "Fr": "الجمعة",
    "Sa": "السبت",
    "So": "الأحد",
    "heute": "اليوم",
    "morgen": "غدًا",
    "am {wochentag} {tag}.{monat}.": "يوم {wochentag} {tag}/{monat}",
    # Push und E-Mails zur Nummer oder zum Termin (app/libs/queue_notify.py, app/libs/notify_worker.py)
    "Dein Laden": "محلك",
    "Du bist dran": "حان دورك",
    "{laden} ruft dich auf. Komm jetzt rein.": "{laden} يستدعيك. ادخل الآن.",
    "Gleich bist du dran": "اقترب دورك",
    "{laden}: Du bist als Nächstes dran. Mach dich auf den Weg.": "{laden}: أنت التالي. انطلق الآن.",
    "{laden}: Nur noch {n} vor dir. Mach dich auf den Weg.": "{laden}: لم يبقَ أمامك سوى {n}. انطلق الآن.",
    "Erinnerung an deinen Termin": "تذكير بموعدك",
    "{laden}, heute um {zeit}. Kannst du nicht? Dann sag bitte ab.": "{laden}، اليوم الساعة {zeit}. لا تستطيع الحضور؟ ألغِ الموعد من فضلك.",
    "Abgesagt": "أُلغي",
    "{laden} hat deine Nummer {wann} um {zeit} abgesagt.": "ألغى {laden} رقمك {wann} الساعة {zeit}.",
    "{laden} hat deinen Termin {wann} um {zeit} abgesagt.": "ألغى {laden} موعدك {wann} الساعة {zeit}.",
    "Neue Uhrzeit": "موعد جديد",
    "{laden} hat deinen Termin verschoben: jetzt {wann} um {zeit}": "نقل {laden} موعدك: الآن {wann} الساعة {zeit}",
    "bei {name}": "مع {name}",
    "(vorher {zeit})": "(سابقًا {zeit})",
    "(vorher {wann} um {zeit})": "(سابقًا {wann} الساعة {zeit})",
    "Früher dran?": "هل تريد دورًا أبكر؟",
    "{laden}: {wann} um {zeit} ist ein Platz frei": "{laden}: {wann} الساعة {zeit} يوجد مكان شاغر",
    "(statt {zeit})": "(بدلًا من {zeit})",
    "Bis {zeit} nur für dich – unter „Meine Termine“ annehmen.": "محجوز لك حتى {zeit} – اقبله في «مواعيدي».",
    "Nur kurz für dich reserviert – unter „Meine Termine“ annehmen.": "محجوز لك لفترة قصيرة – اقبله في «مواعيدي».",
    "Nummer ansehen": "مشاهدة الرقم",
    "Angebot ansehen": "مشاهدة العرض",
    # Rahmen jeder E-Mail (app/libs/mail.py)
    "Klappt der Knopf nicht? Dann öffne diesen Link:": "الزر لا يعمل؟ افتح هذا الرابط إذن:",
    "Impressum": "بيانات الناشر",
    "Diese E-Mail wurde automatisch verschickt.": "أُرسلت هذه الرسالة تلقائيًا.",
    # E-Mail-Adresse bestätigen (app/apis/email_verification)
    "Bitte bestätige deine E-Mail-Adresse": "يرجى تأكيد بريدك الإلكتروني",
    "Ist das deine E-Mail-Adresse?": "هل هذا بريدك الإلكتروني؟",
    "Hallo, du hast bei Dranzeit ein Konto mit der Adresse <strong>{email}</strong> angelegt.":
        "مرحبًا، لقد أنشأت حسابًا على Dranzeit بالعنوان <strong>{email}</strong>.",
    "Hallo, du hast bei Dranzeit ein Konto mit der Adresse {email} angelegt.": "مرحبًا، لقد أنشأت حسابًا على Dranzeit بالعنوان {email}.",
    "Tipp auf den Knopf, dann ist sie bestätigt. So wissen wir, dass die Adresse wirklich dir gehört.":
        "اضغط على الزر لتأكيده. هكذا نعرف أن العنوان يخصك فعلًا.",
    "Öffne diesen Link, dann ist sie bestätigt:": "افتح هذا الرابط لتأكيده:",
    "E-Mail-Adresse bestätigen": "تأكيد البريد الإلكتروني",
    "Du hast kein Konto bei Dranzeit angelegt? Dann hat sich jemand vertippt. Du kannst diese E-Mail einfach löschen.":
        "لم تنشئ حسابًا على Dranzeit؟ إذن أخطأ أحدهم في كتابة العنوان. يمكنك ببساطة حذف هذه الرسالة.",
    "Wir haben dir gerade erst eine E-Mail geschickt. Warte eine Minute, dann geht es noch mal.":
        "أرسلنا إليك رسالة للتو. انتظر دقيقة ثم حاول مرة أخرى.",
    "Heute haben wir dir schon {n} E-Mails geschickt. Versuch es morgen noch mal.": "أرسلنا إليك اليوم {n} رسائل بالفعل. حاول مرة أخرى غدًا.",
    "Zu deinem Konto gibt es keine E-Mail-Adresse.": "لا يوجد بريد إلكتروني مرتبط بحسابك.",
    "Die E-Mail konnte gerade nicht verschickt werden. Versuch es später noch mal.": "تعذّر إرسال الرسالة حاليًا. حاول مرة أخرى لاحقًا.",
    # Passwort vergessen (app/apis/password_reset)
    "Neues Passwort für Dranzeit": "كلمة مرور جديدة لـ Dranzeit",
    "Neues Passwort setzen": "تعيين كلمة مرور جديدة",
    "Hallo, für dein Dranzeit-Konto <strong>{email}</strong> wurde ein neues Passwort angefordert.":
        "مرحبًا، طُلبت كلمة مرور جديدة لحسابك على Dranzeit <strong>{email}</strong>.",
    "Hallo, für dein Dranzeit-Konto {email} wurde ein neues Passwort angefordert.": "مرحبًا، طُلبت كلمة مرور جديدة لحسابك على Dranzeit {email}.",
    "Tipp auf den Knopf und wähl ein neues Passwort. Der Link gilt eine Stunde.": "اضغط على الزر واختر كلمة مرور جديدة. الرابط صالح لمدة ساعة.",
    "Öffne diesen Link und wähl ein neues Passwort (gilt eine Stunde):": "افتح هذا الرابط واختر كلمة مرور جديدة (صالح لمدة ساعة):",
    "Du hast kein neues Passwort angefordert? Dann kannst du diese E-Mail einfach löschen. Dein Passwort bleibt, wie es ist.":
        "لم تطلب كلمة مرور جديدة؟ إذن يمكنك ببساطة حذف هذه الرسالة. تبقى كلمة مرورك كما هي.",
    "Wir haben gerade erst eine E-Mail an diese Adresse geschickt. Warte eine Minute, dann geht es noch mal.":
        "أرسلنا للتو رسالة إلى هذا العنوان. انتظر دقيقة ثم حاول مرة أخرى.",
    "Heute ging schon zu oft eine E-Mail raus. Versuch es morgen noch mal.": "أُرسلت رسائل كثيرة جدًا اليوم. حاول مرة أخرى غدًا.",
    "Diese E-Mail-Adresse sieht nicht richtig aus.": "هذا البريد الإلكتروني لا يبدو صحيحًا.",
    # Team-Einladung (app/apis/staff_invitation)
    "Einladung ins Team von {laden}": "دعوة للانضمام إلى فريق {laden}",
    "Du bist ins Team von {laden} eingeladen": "أنت مدعو للانضمام إلى فريق {laden}",
    "Du bist ins Team von {laden} eingeladen.": "أنت مدعو للانضمام إلى فريق {laden}.",
    "Hallo {name},": "مرحبًا {name}،",
    "Hallo,": "مرحبًا،",
    "{hallo} <strong>{laden}</strong> nutzt Dranzeit für Termine und die Warteschlange und hat dich ins Team eingeladen.":
        "{hallo} يستخدم <strong>{laden}</strong> تطبيق Dranzeit للمواعيد وقائمة الانتظار ودعاك إلى الفريق.",
    "Leg über den Link dein Konto an oder melde dich mit deinem bestehenden an. Danach siehst du unter „Mein Tag“ deine eigenen Kunden.":
        "أنشئ حسابك عبر الرابط أو سجّل الدخول بحسابك الحالي. بعد ذلك سترى عملاءك في «يومي».",
    "{laden} nutzt Dranzeit für Termine und die Warteschlange. Leg über diesen Link dein Konto an oder melde dich mit deinem bestehenden an:":
        "يستخدم {laden} تطبيق Dranzeit للمواعيد وقائمة الانتظار. أنشئ حسابك عبر هذا الرابط أو سجّل الدخول بحسابك الحالي:",
    "Einladung annehmen": "قبول الدعوة",
    "Der Link gilt {n} Tage. Fragen beantwortet dir dein Laden.": {
        "one": "الرابط صالح ليوم واحد. يجيب محلك عن أسئلتك.",
        "two": "الرابط صالح ليومين. يجيب محلك عن أسئلتك.",
        "few": "الرابط صالح لمدة {n} أيام. يجيب محلك عن أسئلتك.",
        "many": "الرابط صالح لمدة {n} يومًا. يجيب محلك عن أسئلتك.",
        "other": "الرابط صالح لمدة {n} يوم. يجيب محلك عن أسئلتك.",
    },
    "deinem Laden": "محلك",
    "An Testadressen wie example.com verschickt Dranzeit keine E-Mails.": "لا يرسل Dranzeit رسائل إلى عناوين الاختبار مثل example.com.",
    "Der E-Mail-Versand ist gerade nicht eingerichtet.": "إرسال الرسائل غير مُعدّ حاليًا.",
    "Die E-Mail konnte nicht verschickt werden.": "تعذّر إرسال الرسالة.",
    "Diesen Einladungslink gibt es nicht oder er wurde durch einen neueren ersetzt. Bitte deinen Laden um einen neuen.":
        "رابط الدعوة هذا غير موجود أو استُبدل برابط أحدث. اطلب من محلك رابطًا جديدًا.",
    "Diese Person gibt es nicht mehr. Lade die Seite neu.": "هذا الشخص لم يعد موجودًا. أعد تحميل الصفحة.",
    "Die Person": "هذا الشخص",
    "andere Person": "شخص آخر",
    "{name} hat schon ein Konto und sieht „Mein Tag“.": "لدى {name} حساب بالفعل ويرى «يومي».",
    "{name} ist deaktiviert. Hol sie zuerst zurück ins Team.": "{name} معطّل. أعده إلى الفريق أولًا.",
    "Für die E-Mail fehlt die Adresse. Trag sie unter „Bearbeiten“ ein und speichere.": "عنوان البريد الإلكتروني ناقص. أدخله في «تعديل» واحفظ.",
    "Diese Einladung wurde schon mit einem anderen Konto angenommen.": "قُبلت هذه الدعوة بالفعل بحساب آخر.",
    "Die Einladung gilt nicht mehr. Bitte deinen Laden um einen neuen Link.": "لم تعد الدعوة صالحة. اطلب من محلك رابطًا جديدًا.",
    "Du bist mit dem Konto des Ladens angemeldet. Den Link öffnet die eingeladene Person mit ihrem eigenen Konto.":
        "أنت مسجّل الدخول بحساب المحل. يفتح الشخص المدعو هذا الرابط بحسابه الخاص.",
    "Dein Konto steht im Team von {laden} schon als {name}.": "حسابك موجود بالفعل في فريق {laden} باسم {name}.",
    # Start-Mails an neue Läden (app/libs/onboarding_mail.py)
    "Willkommen bei Dranzeit – {laden} ist startklar": "مرحبًا بك في Dranzeit – {laden} جاهز للانطلاق",
    "Schön, dass du da bist.": "يسعدنا وجودك معنا.",
    "{laden} ist eingerichtet. Ab jetzt ziehen deine Kunden per QR-Code eine Nummer und warten, wo sie wollen.":
        "تم إعداد {laden}. من الآن يأخذ عملاؤك رقم انتظار عبر رمز QR وينتظرون أينما يريدون.",
    "Drei Dinge, dann läuft es:": "ثلاث خطوات ويعمل كل شيء:",
    "<strong>1. Einmal selbst ausprobieren:</strong> Mit dem Handy den QR-Code am Tresen scannen, eine Nummer ziehen und am Tresen "
    "aufrufen. Auf dem Handy erscheint „Du bist dran“.":
        "<strong>1. جرّبه بنفسك مرة:</strong> امسح رمز QR عند الاستقبال بهاتفك، وخذ رقمًا ثم استدعه من الاستقبال. "
        "سيظهر على الهاتف «حان دورك».",
    "<strong>2. QR-Plakat aufhängen:</strong> Am Tresen unter „…“ → „QR-Plakat drucken“, dann an Tür oder Tresen.":
        "<strong>2. علّق ملصق QR:</strong> في الاستقبال من «…» ← «طباعة ملصق QR»، ثم علّقه على الباب أو عند الاستقبال.",
    "<strong>3. Team einladen:</strong> Arbeitest du nicht allein, schick jeder Person ihren Einladungslink (unter „Team“).":
        "<strong>3. ادعُ فريقك:</strong> إذا كنت لا تعمل وحدك، أرسل لكل شخص رابط دعوته (في «الفريق»).",
    "Als Gründer kannst du bis zum {datum} alles kostenlos nutzen.": "بصفتك مؤسسًا يمكنك استخدام كل شيء مجانًا حتى {datum}.",
    "Die nächsten {n} Tage kannst du alles kostenlos nutzen, ohne Zahlungsdaten.": {
        "one": "يمكنك استخدام كل شيء مجانًا ليوم آخر، دون بيانات دفع.",
        "two": "يمكنك استخدام كل شيء مجانًا في اليومين القادمين، دون بيانات دفع.",
        "few": "يمكنك استخدام كل شيء مجانًا في الأيام الـ {n} القادمة، دون بيانات دفع.",
        "many": "يمكنك استخدام كل شيء مجانًا في الـ {n} يومًا القادمة، دون بيانات دفع.",
        "other": "يمكنك استخدام كل شيء مجانًا في الـ {n} يوم القادمة، دون بيانات دفع.",
    },
    "Zum Tresen": "إلى الاستقبال",
    "In zwei Minuten ausprobiert: deine erste Nummer": "جرّبه في دقيقتين: رقمك الأول",
    "Schon ausprobiert?": "هل جرّبته بعد؟",
    "Bei {laden} wurde noch keine Nummer gezogen. Am schnellsten siehst du, wie Dranzeit funktioniert, wenn du es einmal selbst machst:":
        "لم يُؤخذ أي رقم في {laden} بعد. أسرع طريقة لترى كيف يعمل Dranzeit هي أن تجرّبه بنفسك مرة:",
    "Scann mit deinem Handy den QR-Code am Tresen, zieh eine Nummer und tipp am Tresen auf „Nächste Nummer aufrufen“. Auf dem Handy "
    "steht dann „Du bist dran“. Das dauert zwei Minuten.":
        "امسح بهاتفك رمز QR عند الاستقبال، وخذ رقمًا ثم اضغط في الاستقبال على «استدعاء الرقم التالي». سيظهر على الهاتف "
        "«حان دورك». يستغرق ذلك دقيقتين.",
    "Hängt es irgendwo, zum Beispiel bei Öffnungszeiten oder Leistungen? Antworte auf diese E-Mail, wir helfen dir.":
        "هل تواجه مشكلة في مكان ما، مثل أوقات العمل أو الخدمات؟ رُدّ على هذه الرسالة وسنساعدك.",
    "Diese Erinnerung bekommst du nur einmal.": "يصلك هذا التذكير مرة واحدة فقط.",
    "Deine Testphase endet am {datum}": "تنتهي فترتك التجريبية في {datum}",
    "Noch {n} Tage alles testen": {
        "one": "بقي يوم واحد لتجربة كل شيء",
        "two": "بقي يومان لتجربة كل شيء",
        "few": "بقيت {n} أيام لتجربة كل شيء",
        "many": "بقي {n} يومًا لتجربة كل شيء",
        "other": "بقي {n} يوم لتجربة كل شيء",
    },
    "Als Gründer bekommst du danach den Laden-Tarif dauerhaft für 19 € im Monat (netto). Wähl dafür unter „Mein Tarif“ das Abo. Ohne "
    "Abo läuft dein Laden im Gratis-Tarif weiter.":
        "بصفتك مؤسسًا تحصل بعد ذلك على باقة المحل بشكل دائم مقابل 19 € شهريًا (صافي). اختر الاشتراك في «باقتي». "
        "بدون اشتراك يستمر محلك في الباقة المجانية.",
    "Danach läuft dein Laden automatisch im Gratis-Tarif weiter: {personen} Person, bis {kunden} Kunden im Monat, Nummer ziehen per "
    "QR-Code. Online-Termine, Benachrichtigungen, Team, Wartezimmer-Bildschirm und Auswertung gibt es dann mit einem Abo.":
        "بعد ذلك يستمر محلك تلقائيًا في الباقة المجانية: {personen} شخص، حتى {kunden} عميل شهريًا، وأخذ الأرقام عبر رمز QR. "
        "المواعيد عبر الإنترنت والإشعارات والفريق وشاشة غرفة الانتظار والإحصاءات تتوفر عندها مع اشتراك.",
    "Am {datum} endet die Testphase von {laden}.": "تنتهي الفترة التجريبية لـ {laden} في {datum}.",
    "Reicht dir Gratis, musst du nichts tun. Ohne Abo entstehen keine Kosten.":
        "إذا كانت الباقة المجانية تكفيك فلا داعي لفعل شيء. بدون اشتراك لا توجد أي تكاليف.",
    "Tarife ansehen": "عرض الباقات",
    "Fragen? Antworte einfach auf diese E-Mail oder schreib an {kontakt}. Anleitungen findest du unter {hilfe}.":
        "لديك أسئلة؟ رُدّ ببساطة على هذه الرسالة أو راسلنا على {kontakt}. تجد الإرشادات على {hilfe}.",
    "Fragen? {kontakt}": "لديك أسئلة؟ {kontakt}",
    # Fehlermeldungen: Nummer, Benachrichtigungen, Früher dran
    "Diese Nummer gibt es nicht.": "هذا الرقم غير موجود.",
    "Diese Nummer lässt sich hier nicht ändern. Nimm das Handy, mit dem du sie gezogen hast, oder sag am Tresen Bescheid.":
        "لا يمكن تغيير هذا الرقم هنا. استخدم الهاتف الذي أخذت به الرقم، أو أخبر الاستقبال.",
    "Du bist schon dran oder fertig – sag bitte am Tresen Bescheid.": "حان دورك بالفعل أو انتهيت – أخبر الاستقبال من فضلك.",
    "Dieser Laden bietet keine Benachrichtigungen an.": "هذا المحل لا يقدم إشعارات.",
    "Benachrichtigungen für diese Nummer gehen nur auf dem Handy, mit dem sie gezogen wurde, oder mit deinem Konto.":
        "الإشعارات لهذا الرقم تعمل فقط على الهاتف الذي أُخذ به الرقم، أو بحسابك.",
    "Diese Nummer ist schon erledigt oder abgesagt.": "هذا الرقم انتهى بالفعل أو أُلغي.",
    "Diese Nummer liegt in der Vergangenheit.": "هذا الرقم في الماضي.",
    "Benachrichtigungen sind gerade nicht eingerichtet.": "الإشعارات غير مُعدّة حاليًا.",
    "Ungültige Push-Adresse.": "عنوان إشعارات غير صالح.",
    "Für diese Nummer sind schon genug Geräte angemeldet.": "سُجّل عدد كافٍ من الأجهزة لهذا الرقم بالفعل.",
    "E-Mails sind gerade nicht eingerichtet.": "الرسائل غير مُعدّة حاليًا.",
    "Das ist nicht dein Termin.": "هذا ليس موعدك.",
    "Diesen Termin gibt es nicht mehr.": "هذا الموعد لم يعد موجودًا.",
    "Für diesen Termin geht „Früher dran“ nicht mehr: Er hat schon angefangen oder ist abgesagt.":
        "«دور أبكر» لم يعد ممكنًا لهذا الموعد: لقد بدأ بالفعل أو أُلغي.",
    "Dieser Laden bietet „Früher dran“ gerade nicht an.": "هذا المحل لا يقدم «دور أبكر» حاليًا.",
    "Nur die eigenen Benachrichtigungen.": "إشعاراتك الخاصة فقط.",
    "Zu viele Anfragen. Versuch es gleich noch einmal.": "طلبات كثيرة جدًا. حاول مرة أخرى بعد قليل.",
    # Fehlermeldungen: Kunden-Link, Datenschutz, Zugriff
    "Diesen Link gibt es nicht. Bitte den Laden um einen neuen.": "هذا الرابط غير موجود. اطلب من المحل رابطًا جديدًا.",
    "Diesen Kunden gibt es nicht mehr. Lade die Seite neu.": "هذا العميل لم يعد موجودًا. أعد تحميل الصفحة.",
    "{name} hat das Konto schon verbunden und braucht keinen Link.": "ربط {name} الحساب بالفعل ولا يحتاج إلى رابط.",
    "Dieser Link ist schon mit einem anderen Konto verbunden.": "هذا الرابط مرتبط بالفعل بحساب آخر.",
    "Der Link ist abgelaufen. Bitte den Laden um einen neuen.": "انتهت صلاحية الرابط. اطلب من المحل رابطًا جديدًا.",
    "Du bist mit dem Konto des Ladens angemeldet. Den Link öffnet die Kundin oder der Kunde mit dem eigenen Konto.":
        "أنت مسجّل الدخول بحساب المحل. يفتح العميل هذا الرابط بحسابه الخاص.",
    "Diesen Laden gibt es nicht.": "هذا المحل غير موجود.",
    "Diesen Kunden gibt es nicht mehr.": "هذا العميل لم يعد موجودًا.",
    "Konten von Läden und Teams löschen wir auf Anfrage. Schreib uns an {kontakt}.": "نحذف حسابات المحلات والفرق عند الطلب. راسلنا على {kontakt}.",
    "Nur für den Betreiber der App.": "لمشغّل التطبيق فقط.",
    "Das ist nicht dein Laden.": "هذا ليس محلك.",
    "Diesen Laden gibt es nicht mehr.": "هذا المحل لم يعد موجودًا.",
    "Nur für Betriebe.": "للمحلات فقط.",
    # Fehlermeldungen: Abo und Rechnungen
    "Laden nicht gefunden.": "لم يُعثر على المحل.",
    "Stripe meldet: {grund}": "رسالة من Stripe: {grund}",
    "Die Bezahlung klappt gerade nicht. Bitte versuch es später noch einmal.": "الدفع لا يعمل حاليًا. حاول مرة أخرى لاحقًا.",
    "Die Bezahlung ist noch nicht fertig eingerichtet. Schreib uns, wir schalten dich frei.": "الدفع غير مُعدّ بالكامل بعد. راسلنا وسنفعّل حسابك.",
    "Die Bezahlung ist noch nicht eingerichtet. Schreib uns, wir schalten dich frei.": "الدفع غير مُعدّ بعد. راسلنا وسنفعّل حسابك.",
    "Unbekannter Tarif.": "باقة غير معروفة.",
    "Für diesen Laden gibt es noch kein Abo.": "لا يوجد اشتراك لهذا المحل بعد.",
    "Das Gründerangebot gilt nur für Läden ohne laufendes Abo.": "عرض المؤسسين متاح فقط للمحلات التي ليس لديها اشتراك فعّال.",
    "Die 100 Gründerplätze sind vergeben.": "حُجزت أماكن المؤسسين المئة كلها.",
    "Die Rechnung lässt sich gerade nicht laden.": "تعذّر تحميل الفاتورة حاليًا.",
    "Die Rechnung lässt sich gerade nicht laden. Bitte versuch es gleich noch einmal.": "تعذّر تحميل الفاتورة حاليًا. حاول مرة أخرى بعد قليل.",
    "Rechnung nicht gefunden.": "لم يُعثر على الفاتورة.",
    "Für diese Rechnung gibt es noch kein PDF.": "لا يوجد ملف PDF لهذه الفاتورة بعد.",
    "Für diese Rechnung gibt es keine E-Rechnung: {grund}": "لا توجد فاتورة إلكترونية لهذه الفاتورة: {grund}",
    # Fehlermeldungen: Laden einrichten (app/apis/shop_setup) und Verzeichnis
    "Zu viele Anfragen. Bitte in einer Stunde noch einmal.": "طلبات كثيرة جدًا. حاول مرة أخرى بعد ساعة.",
    "Das ist keine Webadresse.": "هذا ليس عنوان موقع.",
    "Diese Webadresse wird nicht gelesen.": "لا تتم قراءة عنوان الموقع هذا.",
    "Diese Webseite gibt es nicht (Adresse nicht gefunden).": "هذا الموقع غير موجود (لم يُعثر على العنوان).",
    "Die Webseite antwortet zu langsam.": "الموقع يستجيب ببطء شديد.",
    "Das ist keine Webseite.": "هذا ليس موقعًا إلكترونيًا.",
    "Zu viele Weiterleitungen.": "عمليات إعادة توجيه كثيرة جدًا.",
    "Die Auswertung ist gerade ausgelastet. Bitte gleich noch einmal.": "التحليل مشغول حاليًا. حاول مرة أخرى بعد قليل.",
    "Die Preisliste konnte gerade nicht ausgewertet werden.": "تعذّر تحليل قائمة الأسعار حاليًا.",
    "Die Google-Suche ist nicht eingerichtet.": "بحث Google غير مُعدّ.",
    "Google ist gerade nicht erreichbar.": "تعذّر الوصول إلى Google حاليًا.",
    "Die Google-Suche hat nicht geklappt.": "لم ينجح بحث Google.",
    "Unbekannter Eintrag.": "إدخال غير معروف.",
    "Der Eintrag konnte nicht geladen werden.": "تعذّر تحميل الإدخال.",
    "Das Auslesen der Preisliste ist nicht eingerichtet.": "قراءة قائمة الأسعار غير مُعدّة.",
    "Gerade lesen viele gleichzeitig. Bitte in einer Minute noch einmal.": "يقرأ كثيرون في الوقت نفسه الآن. حاول مرة أخرى بعد دقيقة.",
    "Zu viele Anfragen. Bitte später noch einmal.": "طلبات كثيرة جدًا. حاول مرة أخرى لاحقًا.",
    "Diesen Eintrag gibt es nicht.": "هذا الإدخال غير موجود.",
    "Dieser Laden hat keine Seite im Verzeichnis.": "ليس لهذا المحل صفحة في الدليل.",
    "Bitte bestätigen, dass du zu diesem Salon gehörst.": "يرجى التأكيد أنك تنتمي إلى هذا الصالون.",
    # Übernahme per Code (app/libs/uebernahme.py)
    "Diese Seite gehört schon zu einem Dranzeit-Laden.": "هذه الصفحة تابعة بالفعل لمحل على Dranzeit.",
    "Diesen Code kennen wir nicht. Prüf ihn bitte noch einmal.": "لا نعرف هذا الرمز. يُرجى التحقق منه مرة أخرى.",
    "Dieser Code ist schon eingelöst. Melde dich mit dem Konto an, mit dem du deinen Laden eingerichtet hast.": "تم استخدام هذا الرمز بالفعل. سجّل الدخول بالحساب الذي أعددت به محلك.",
    "Dieser Code ist abgelaufen. Schreib uns an hilfe@dranzeit.de, dann bekommst du einen neuen.": "انتهت صلاحية هذا الرمز. راسلنا على hilfe@dranzeit.de وسنرسل لك رمزًا جديدًا.",
    # Nachrichten an das Team (app/libs/team_notify.py, app/apis/team_push)
    "Neue Nummer {nummer}": "رقم جديد {nummer}",
    "Neue Nummer": "رقم جديد",
    "Neue Buchung": "حجز جديد",
    "Nummer {nummer} zurückgegeben": "غادر الرقم {nummer} قائمة الانتظار",
    "Nummer zurückgegeben": "غادر رقم قائمة الانتظار",
    "Termin abgesagt": "أُلغي الموعد",
    "{wann} gegen {zeit}": "{wann} نحو الساعة {zeit}",
    "{wann} um {zeit}": "{wann} الساعة {zeit}",
    "(per Telefon)": "(عبر الهاتف)",
    "{n} neue Nummern": {
        "one": "رقم جديد واحد",
        "two": "رقمان جديدان",
        "few": "{n} أرقام جديدة",
        "many": "{n} رقمًا جديدًا",
        "other": "{n} رقم جديد",
    },
    "{n} neue Buchungen": {
        "one": "حجز جديد واحد",
        "two": "حجزان جديدان",
        "few": "{n} حجوزات جديدة",
        "many": "{n} حجزًا جديدًا",
        "other": "{n} حجز جديد",
    },
    "{n} Absagen": {
        "one": "إلغاء واحد",
        "two": "إلغاءان",
        "few": "{n} إلغاءات",
        "many": "{n} إلغاءً",
        "other": "{n} إلغاء",
    },
    "Neu bei {laden}": "جديد في {laden}",
    "Dieses Konto gehört zu keinem Laden.": "هذا الحساب لا ينتمي إلى أي محل.",
}
