import React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarPlus, Users, Store, Clock, BellRing, BarChart, CheckSquare, Calendar } from "lucide-react";

export default function Features() {
  const navigate = useNavigate();
  
  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
      <nav className="border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="text-2xl font-bold cursor-pointer" onClick={() => navigate('/')}>Q-ME</div>
          <div className="flex gap-4">
            <Button variant="ghost" onClick={() => navigate('/features')}>Funktionen</Button>
            <Button variant="ghost" onClick={() => navigate('/about')}>Über uns</Button>
            <Button variant="ghost" onClick={() => navigate('/login')}>Anmelden</Button>
            <Button variant="default" onClick={() => navigate('/register')}>Registrieren</Button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="py-12 bg-gray-50">
        <div className="container mx-auto px-4 text-center">
          <h1 className="text-4xl font-bold mb-4">Unsere Funktionen</h1>
          <p className="text-xl text-gray-600 mb-6 max-w-2xl mx-auto">
            Entdecken Sie alle Möglichkeiten, die Q-ME für Ihre Terminverwaltung bietet.
          </p>
        </div>
      </section>

      {/* Features for Shop Owners */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-4">Für Shopbetreiber</h2>
          <p className="text-center text-gray-600 mb-10 max-w-3xl mx-auto">
            Optimieren Sie Ihr Geschäft mit leistungsstarken Verwaltungswerkzeugen
          </p>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            <Card>
              <CardHeader>
                <Store className="w-8 h-8 text-primary mb-2" />
                <CardTitle>Shop-Verwaltung</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">
                  Erstellen und verwalten Sie Ihr Shop-Profil mit allen relevanten Informationen und Öffnungszeiten.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Users className="w-8 h-8 text-primary mb-2" />
                <CardTitle>Mitarbeitermanagement</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">
                  Verwalten Sie Ihr Team, weisen Sie Rollen zu und überwachen Sie Arbeitszeiten und Leistung.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Calendar className="w-8 h-8 text-primary mb-2" />
                <CardTitle>Terminplanung</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">
                  Konfigurieren Sie verfügbare Zeitfenster und Dienstleistungen für eine optimale Terminplanung.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <BellRing className="w-8 h-8 text-primary mb-2" />
                <CardTitle>Benachrichtigungssystem</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">
                  Automatische Benachrichtigungen für neue Buchungen, Änderungen und Stornierungen.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Clock className="w-8 h-8 text-primary mb-2" />
                <CardTitle>Warteschlangen-Management</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">
                  Effizientes Management von Walk-in-Kunden und Warteschlangen für einen reibungslosen Betrieb.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <BarChart className="w-8 h-8 text-primary mb-2" />
                <CardTitle>Analysen & Berichte</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">
                  Detaillierte Einblicke in Geschäftsdaten, Kundenverhalten und Mitarbeiterleistung.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Features for Employees */}
      <section className="py-16 bg-gray-50">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-4">Für Mitarbeiter</h2>
          <p className="text-center text-gray-600 mb-10 max-w-3xl mx-auto">
            Optimieren Sie Ihren Arbeitsalltag mit effizienten Tools
          </p>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            <Card>
              <CardHeader>
                <Calendar className="w-8 h-8 text-primary mb-2" />
                <CardTitle>Persönlicher Terminkalender</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">
                  Übersichtliche Darstellung aller Termine und Verfügbarkeiten auf einen Blick.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CheckSquare className="w-8 h-8 text-primary mb-2" />
                <CardTitle>Terminverwaltung</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">
                  Einfaches Bestätigen, Verschieben oder Stornieren von Kundenterminen.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Clock className="w-8 h-8 text-primary mb-2" />
                <CardTitle>Arbeitszeiterfassung</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">
                  Transparente Erfassung von Arbeitszeiten und Pausen für eine faire Abrechnung.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Features for Customers */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-4">Für Kunden</h2>
          <p className="text-center text-gray-600 mb-10 max-w-3xl mx-auto">
            Genießen Sie eine stressfreie Terminplanung
          </p>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            <Card>
              <CardHeader>
                <Store className="w-8 h-8 text-primary mb-2" />
                <CardTitle>Shop-Entdeckung</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">
                  Durchsuchen Sie Shops nach Branchen, Standort oder Dienstleistungen und finden Sie genau das, was Sie suchen.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CalendarPlus className="w-8 h-8 text-primary mb-2" />
                <CardTitle>Online-Buchung</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">
                  Buchen Sie Termine rund um die Uhr online, ohne Wartezeiten am Telefon oder vor Ort.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <BellRing className="w-8 h-8 text-primary mb-2" />
                <CardTitle>Terminerinnerungen</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">
                  Automatische Erinnerungen vor Ihrem Termin, damit Sie nichts verpassen.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Clock className="w-8 h-8 text-primary mb-2" />
                <CardTitle>Warteschlangensystem</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">
                  Treten Sie einer virtuellen Warteschlange bei und werden Sie benachrichtigt, wenn Sie an der Reihe sind.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 bg-gray-50">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-6">Überzeugt von unseren Funktionen?</h2>
          <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
            Starten Sie jetzt und optimieren Sie Ihre Terminverwaltung mit Q-ME.
          </p>
          <div className="flex gap-4 justify-center">
            <Button size="lg" variant="default" onClick={() => navigate('/register')}>Kostenlos registrieren</Button>
            <Button size="lg" variant="outline" onClick={() => navigate('/login')}>Anmelden</Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="container mx-auto px-4 text-center text-gray-600">
          <p>© 2024 Q-ME. Alle Rechte vorbehalten.</p>
        </div>
      </footer>
    </div>
  );
}
