import { LegalPage } from '../components/LegalPage';
import { COMPANY } from '@/constants/legal';

export default function Impressum() {
  return (
    <LegalPage title="Impressum">
      <section>
        <h2>Anbieter</h2>
        <p>
          {COMPANY.name}
          <br />
          {COMPANY.street}
          <br />
          {COMPANY.postalCode} {COMPANY.city}
          <br />
          {COMPANY.country}
        </p>
        <p>
          Vertreten durch den Geschäftsführer {COMPANY.managingDirector}
          <br />
          Eingetragen im Handelsregister: {COMPANY.registerCourt}, {COMPANY.registerNumber}
          <br />
          Umsatzsteuer-Identifikationsnummer nach § 27a UStG: {COMPANY.vatId}
        </p>
      </section>
      <section>
        <h2>Kontakt</h2>
        <p>
          E-Mail: <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>
          <br />
          Telefon: {COMPANY.phone}
        </p>
      </section>
      <section>
        <h2>Verantwortlich für den Inhalt</h2>
        <p>
          {COMPANY.managingDirector}, Anschrift wie oben (§ 18 Abs. 2 Medienstaatsvertrag).
        </p>
      </section>
      <section>
        <h2>Streitbeilegung</h2>
        <p>
          Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer
          Verbraucherschlichtungsstelle teilzunehmen (§ 36 VSBG).
        </p>
      </section>
      <section>
        <h2>Inhalte der Läden</h2>
        <p>
          Ladennamen, Leistungen, Preise und Öffnungszeiten tragen die Läden selbst ein. Für diese Angaben ist der
          jeweilige Laden verantwortlich. Wenn dir ein Fehler auffällt, schreib uns, dann kümmern wir uns darum.
        </p>
      </section>
    </LegalPage>
  );
}
