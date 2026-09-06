// VORA — l'onboarding : profil personnel et contacts de confiance.
//
// CE QUE CES TESTS PROTÈGENT. On collecte désormais nom, sexe et date de naissance —
// écart assumé avec `docs/`, qui ne demandait que le prénom. Trois PII de plus, donc
// trois occasions de fuite de plus. Ces tests vérifient qu'aucune ne traverse :
//
//   · vers l'autre partie d'une course (`GET /v1/rides/:id` côté chauffeur) ;
//   · vers le lien public de partage de trajet ;
//   · vers l'assistant de support, donc vers un modèle hébergé ailleurs.
//
// Ils vérifient aussi que les contacts de confiance servent VRAIMENT : ils partent avec
// l'alerte SOS, vers l'ops et vers personne d'autre.

import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabase, db } from '../db/client.js';
import { trustedContacts, users } from '../db/schema.js';
import { seedZones } from '../db/seed/geography.js';
import { MAX_TRUSTED_CONTACTS } from '../domain/profile.js';
import { driverPresence } from '../modules/dispatch/presence.js';
import * as dispatchRepository from '../modules/dispatch/repository.js';
import { buildContext } from '../modules/support/context.js';
import { renderContext } from '../modules/support/prompt.js';
import { clearBuffers, replay } from '../realtime/bus.js';
import { driverRoom, OPS_ROOM } from '../realtime/events.js';
import {
  auth,
  createDriver,
  createPassenger,
  seedTariffs,
  waitFor,
  type TestAccount,
} from './support/fixtures.js';

let app: FastifyInstance;

const MELEN = { lat: 3.8541, lng: 11.4872, label: 'Carrefour Melen' };
const OBILI = { lat: 3.8482, lng: 11.4931, label: 'Carrefour Obili' };
const PRES_DE_MELEN = { lat: 3.857, lng: 11.489 };

/** L'état civil qu'on remplit, et qu'on cherchera ensuite partout où il ne doit pas être. */
const PROFIL = {
  first_name: 'Aïcha',
  family_name: 'Mballa',
  sex: 'female' as const,
  birth_date: '1998-03-12',
  locale: 'fr' as const,
};

beforeAll(async () => {
  await seedZones();
  await seedTariffs();
  app = await buildApp();
  await app.ready();
}, 60_000);

afterAll(async () => {
  driverPresence.clear();
  clearBuffers();
  await app?.close();
  await closeDatabase();
});

async function onboard(account: TestAccount, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/v1/me/onboarding',
    headers: auth(account),
    payload: body,
  });
}

async function me(account: TestAccount) {
  const response = await app.inject({ method: 'GET', url: '/v1/me', headers: auth(account) });
  expect(response.statusCode).toBe(200);
  return response.json();
}

// ─── Le parcours ─────────────────────────────────────────────────────────────

describe('POST /v1/me/onboarding', () => {
  it('à la connexion, l’application sait qu’il reste l’onboarding à faire', async () => {
    const passager = await createPassenger(app, 'Passager Neuf');
    const vue = await me(passager);

    expect(vue.onboarding.completed).toBe(false);
    expect(vue.onboarding.completed_at).toBeNull();
    // De quoi ouvrir les bons écrans, sans deviner.
    expect(vue.onboarding.missing).toContain('family_name');
    expect(vue.onboarding.missing).toContain('trusted_contacts');
    expect(vue.trusted_contacts).toEqual([]);
  }, 30_000);

  it('enregistre le profil et les contacts en un seul appel', async () => {
    const passager = await createPassenger(app, 'Aïcha Onboarding');

    const response = await onboard(passager, {
      ...PROFIL,
      trusted_contacts: [
        { name: 'Maman', phone: '+237690111333' },
        // Saisi à la camerounaise, sans indicatif : la normalisation doit s'en charger.
        { name: 'Paul', phone: '6 91 22 33 44' },
      ],
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.display_name).toBe('Aïcha');
    expect(body.family_name).toBe('Mballa');
    expect(body.sex).toBe('female');
    expect(body.birth_date).toBe('1998-03-12');
    expect(body.onboarding.completed).toBe(true);
    expect(body.onboarding.completed_at).toBeTruthy();

    // Le numéro d'un proche ne ressort pas entier, même à son propriétaire.
    expect(body.trusted_contacts).toHaveLength(2);
    expect(body.trusted_contacts[0].name).toBe('Maman');
    expect(body.trusted_contacts[0].phone_masked).toMatch(/^\+237 6·· ··· ·\d{2}$/);
    expect(JSON.stringify(body)).not.toContain('690111333');
    expect(JSON.stringify(body)).not.toContain('691223344');

    // Et le second numéro a bien été normalisé en E.164 avant d'être stocké.
    const stored = await db
      .select()
      .from(trustedContacts)
      .where(eq(trustedContacts.userId, passager.id));
    expect(stored.map((row) => row.phone).sort()).toEqual(['+237690111333', '+237691223344']);
  }, 30_000);

  it('reste rejouable : le dernier envoi fait foi', async () => {
    const passager = await createPassenger(app, 'Aïcha Deux Fois');

    await onboard(passager, {
      ...PROFIL,
      trusted_contacts: [{ name: 'Maman', phone: '+237690444555' }],
    });
    const second = await onboard(passager, {
      ...PROFIL,
      first_name: 'Aicha',
      trusted_contacts: [{ name: 'Paul', phone: '+237690666777' }],
    });

    expect(second.statusCode).toBe(200);
    // REMPLACÉS, pas ajoutés : un renvoi après une coupure réseau ne crée pas de doublon.
    expect(second.json().trusted_contacts).toHaveLength(1);
    expect(second.json().trusted_contacts[0].name).toBe('Paul');
    expect(second.json().display_name).toBe('Aicha');
  }, 30_000);

  it('« Plus tard » ne touche à rien, une liste vide efface', async () => {
    const passager = await createPassenger(app, 'Aïcha Plus Tard');
    await onboard(passager, {
      ...PROFIL,
      trusted_contacts: [{ name: 'Maman', phone: '+237690888999' }],
    });

    // Champ absent = l'écran des contacts n'a pas été envoyé : on ne touche à rien.
    const sansChamp = await onboard(passager, PROFIL);
    expect(sansChamp.json().trusted_contacts).toHaveLength(1);

    // Liste vide = une décision : elle efface.
    const vide = await onboard(passager, { ...PROFIL, trusted_contacts: [] });
    expect(vide.json().trusted_contacts).toEqual([]);
  }, 30_000);

  it('exige prénom et nom, et refuse une saisie aberrante', async () => {
    const passager = await createPassenger(app, 'Aïcha Fautive');

    // Prénom et nom sont les deux seuls champs exigés (PA-05).
    expect((await onboard(passager, { first_name: 'Aïcha' })).statusCode).toBe(400);
    expect((await onboard(passager, { family_name: 'Mballa' })).statusCode).toBe(400);

    // Une date dans le futur ou un âge de 150 ans est une faute de frappe, pas un utilisateur.
    const future = await onboard(passager, { ...PROFIL, birth_date: '2087-01-01' });
    expect(future.statusCode).toBe(400);
    expect(future.json().details).toMatchObject({ field: 'birth_date' });
    expect((await onboard(passager, { ...PROFIL, birth_date: '1850-01-01' })).statusCode).toBe(400);

    // Un sexe hors catalogue, et un quatrième contact.
    expect((await onboard(passager, { ...PROFIL, sex: 'autre' })).statusCode).toBe(400);
    const trop = await onboard(passager, {
      ...PROFIL,
      trusted_contacts: Array.from({ length: MAX_TRUSTED_CONTACTS + 1 }, (_, i) => ({
        name: `Contact ${i}`,
        phone: `+23769011122${i}`,
      })),
    });
    expect(trop.statusCode).toBe(400);

    // Le même numéro deux fois est une double saisie : le message doit le dire.
    const doublon = await onboard(passager, {
      ...PROFIL,
      trusted_contacts: [
        { name: 'Maman', phone: '+237690111333' },
        { name: 'Maman (bis)', phone: '690 11 13 33' },
      ],
    });
    expect(doublon.statusCode).toBe(400);
    expect(doublon.json().message).toMatch(/même numéro/i);
  }, 30_000);

  it('un chauffeur garde son dossier de pièces à faire, en plus', async () => {
    const chauffeur = await createDriver(app, { displayName: 'Boris KYC' });
    // `createDriver` pose un dossier déjà validé : on vérifie le drapeau dans les deux sens.
    expect((await me(chauffeur)).onboarding.driver_kyc_required).toBe(false);

    const passager = await createPassenger(app, 'Aïcha Sans KYC');
    expect((await me(passager)).onboarding.driver_kyc_required).toBe(false);
  }, 30_000);

  it('exige un jeton', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/me/onboarding',
      payload: PROFIL,
    });
    expect(response.statusCode).toBe(401);
  });
});

// ─── Ce que l'état civil ne doit jamais traverser ────────────────────────────

describe('nom, sexe et date de naissance restent chez leur propriétaire', () => {
  it('le chauffeur ne voit que le prénom, le partage public non plus', async () => {
    driverPresence.clear();
    const passager = await createPassenger(app, 'Prénom Provisoire');
    const chauffeur = await createDriver(app, { displayName: 'Boris Curieux' });

    await onboard(passager, {
      ...PROFIL,
      trusted_contacts: [{ name: 'Maman', phone: '+237690222444' }],
    });

    await app.inject({
      method: 'POST',
      url: '/v1/driver/online',
      headers: auth(chauffeur),
      payload: { position: PRES_DE_MELEN },
    });

    const devis = await app.inject({
      method: 'POST',
      url: '/v1/quotes',
      headers: auth(passager),
      payload: { pickup: MELEN, dropoff: OBILI },
    });
    const eco = (
      devis.json() as { offers: Array<{ offer: string; quoteId: string }> }
    ).offers.find((offre) => offre.offer === 'eco')!;

    const course = await app.inject({
      method: 'POST',
      url: '/v1/rides',
      headers: { ...auth(passager), 'idempotency-key': crypto.randomUUID() },
      payload: { quoteId: eco.quoteId, offer: 'eco', paymentMethod: 'cash' },
    });
    const rideId = (course.json() as { id: string }).id;

    const depuis = new Date(Date.now() - 120_000).toISOString();
    const offerId = await waitFor(
      async () => {
        const trouve = replay(driverRoom(chauffeur.id), depuis).find(
          (entree) =>
            entree.event === 'ride.offer' &&
            (entree.payload as { rideId: string }).rideId === rideId,
        );
        return trouve ? (trouve.payload as { offerId: string }).offerId : null;
      },
      { label: 'offre de dispatch' },
    );
    expect((await dispatchRepository.listOffers(rideId)).some((o) => o.id === offerId)).toBe(true);
    await app.inject({
      method: 'POST',
      url: `/v1/driver/offers/${offerId}/accept`,
      headers: auth(chauffeur),
    });

    // 1. La course, vue du chauffeur.
    const vueChauffeur = await app.inject({
      method: 'GET',
      url: `/v1/rides/${rideId}`,
      headers: auth(chauffeur),
    });
    const brut = vueChauffeur.body;
    expect(vueChauffeur.json().passenger.first_name).toBe('Aïcha');
    for (const interdit of ['Mballa', 'female', '1998-03-12', '690222444', 'Maman']) {
      expect(brut, `« ${interdit} » visible du chauffeur`).not.toContain(interdit);
    }

    // 2. Le lien public de partage de trajet.
    const partage = await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/share`,
      headers: auth(passager),
    });
    const token = (partage.json() as { url: string }).url.split('/').pop();
    const vuePublique = await app.inject({ method: 'GET', url: `/v1/share/${token}` });
    expect(vuePublique.statusCode).toBe(200);
    for (const interdit of ['Mballa', 'female', '1998-03-12', 'Aïcha', 'Maman']) {
      expect(vuePublique.body, `« ${interdit} » dans le lien public`).not.toContain(interdit);
    }

    // 3. Le contexte envoyé à l'assistant de support — donc hors de nos machines.
    const contexte = await buildContext(
      { id: passager.id, role: 'passenger' },
      'combien coûte ma course ?',
    );
    const envoye = `${JSON.stringify(contexte)}\n${renderContext(contexte)}`;
    for (const interdit of ['Mballa', 'female', '1998-03-12', 'Aïcha', 'Maman', '690222444']) {
      expect(envoye, `« ${interdit} » envoyé au modèle`).not.toContain(interdit);
    }
  }, 90_000);
});

// ─── Les contacts de confiance servent vraiment ──────────────────────────────

describe('le SOS transmet les contacts de confiance à l’ops', () => {
  it('avec leur numéro entier, et vers la salle ops seulement', async () => {
    driverPresence.clear();
    const passager = await createPassenger(app, 'Aïcha SOS');
    const chauffeur = await createDriver(app, { displayName: 'Boris SOS' });

    await onboard(passager, {
      ...PROFIL,
      trusted_contacts: [{ name: 'Maman', phone: '+237690777111' }],
    });

    await app.inject({
      method: 'POST',
      url: '/v1/driver/online',
      headers: auth(chauffeur),
      payload: { position: PRES_DE_MELEN },
    });
    const devis = await app.inject({
      method: 'POST',
      url: '/v1/quotes',
      headers: auth(passager),
      payload: { pickup: MELEN, dropoff: OBILI },
    });
    const eco = (
      devis.json() as { offers: Array<{ offer: string; quoteId: string }> }
    ).offers.find((offre) => offre.offer === 'eco')!;
    const course = await app.inject({
      method: 'POST',
      url: '/v1/rides',
      headers: { ...auth(passager), 'idempotency-key': crypto.randomUUID() },
      payload: { quoteId: eco.quoteId, offer: 'eco', paymentMethod: 'cash' },
    });
    const rideId = (course.json() as { id: string }).id;

    const depuis = new Date(Date.now() - 1000).toISOString();
    const sos = await app.inject({
      method: 'POST',
      url: `/v1/rides/${rideId}/sos`,
      headers: auth(passager),
      payload: { note: 'je ne me sens pas en sécurité' },
    });

    expect(sos.statusCode).toBe(200);
    // L'écran peut désormais dire la vérité : les proches sont entre les mains de l'ops.
    expect(sos.json().notified).toContain('trusted_contacts');

    const alerte = replay(OPS_ROOM, depuis).find((entree) => entree.event === 'ops.alert');
    expect(alerte, 'aucune alerte dans la salle ops').toBeTruthy();
    const payload = alerte!.payload as { trustedContacts: Array<{ name: string; phone: string }> };
    // L'ops doit pouvoir DÉCROCHER SON TÉLÉPHONE : ici, et ici seulement, le numéro est entier.
    expect(payload.trustedContacts).toEqual([{ name: 'Maman', phone: '+237690777111' }]);

    // Mais rien de tout cela ne part vers la salle de la course, donc vers le chauffeur.
    const versLaCourse = replay(`ride:${rideId}`, depuis);
    expect(JSON.stringify(versLaCourse)).not.toContain('690777111');
    expect(JSON.stringify(versLaCourse)).not.toContain('Maman');
  }, 90_000);
});

// ─── Vérification directe en base ────────────────────────────────────────────

describe('la base garde ce qu’il faut, et rien de plus', () => {
  it('écrit l’état civil sur users et les contacts à côté', async () => {
    const passager = await createPassenger(app, 'Aïcha Base');
    await onboard(passager, {
      ...PROFIL,
      trusted_contacts: [{ name: 'Maman', phone: '+237690333222' }],
    });

    const [row] = await db.select().from(users).where(eq(users.id, passager.id));
    expect(row?.displayName).toBe('Aïcha');
    expect(row?.familyName).toBe('Mballa');
    expect(row?.sex).toBe('female');
    expect(row?.birthDate).toBe('1998-03-12');
    expect(row?.onboardedAt).toBeInstanceOf(Date);
  }, 30_000);
});
