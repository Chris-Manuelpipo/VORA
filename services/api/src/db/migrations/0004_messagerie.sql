-- VORA — messages prédéfinis liés à une course.
--
-- Le brief (§ 5.7) prévoit en v1 une conversation texte, des messages vocaux de 10 s et
-- un appel VORA en voix sur IP. CLAUDE.md § 8.3 coupe les trois : un TURN à configurer,
-- une modération à écrire et un réveil Android à dompter, pour une fonctionnalité que le
-- jury ne verra pas passer. Ce qui reste est la partie qui résout le VRAI problème de
-- Yaoundé — se retrouver au point de rendez-vous quand il n'y a pas d'adresse.
--
-- IL N'Y A PAS DE COLONNE `body`, ET C'EST LE FOND DU SUJET.
-- Sans champ de texte : rien à modérer, rien à chiffrer, rien à conserver 90 jours, et
-- aucun moyen de se donner un numéro de téléphone en contournant CLAUDE.md § 5.6. La
-- contrainte CHECK ci-dessous fait de cette promesse une règle de la base : même un
-- INSERT à la main en psql ne peut écrire que ces six valeurs.
--
-- Pas de colonne `read_at` non plus : un accusé de lecture demanderait un aller-retour
-- de plus par message et n'apporte rien ici — les deux parties se voient sur la carte.

CREATE TABLE "ride_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "ride_id" uuid NOT NULL REFERENCES "rides"("id") ON DELETE CASCADE,
  -- Qui parle. Déduit du jeton par le serveur, jamais du corps de la requête : un
  -- passager ne doit pas pouvoir écrire « J'arrive » à la place de son chauffeur.
  "sender" text NOT NULL,
  "code" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ride_messages_sender_check" CHECK ("sender" IN ('passenger', 'driver')),
  -- Les six codes de `src/domain/messages.ts`, et l'appariement avec l'expéditeur :
  -- « J'arrive » est un message de chauffeur, « Je suis là » un message de passager.
  CONSTRAINT "ride_messages_code_check" CHECK (
    ("sender" = 'passenger' AND "code" IN ('IM_HERE', 'WHERE_ARE_YOU', 'WAIT_2MIN'))
    OR ("sender" = 'driver' AND "code" IN ('ARRIVING', 'IM_OUTSIDE', 'CANT_FIND'))
  )
);
--> statement-breakpoint
-- La lecture est toujours « les messages de CETTE course, dans l'ordre » : l'index porte
-- les deux colonnes de cette phrase.
CREATE INDEX "ride_messages_ride_idx" ON "ride_messages" ("ride_id", "created_at");
--> statement-breakpoint
-- Journal, pas conversation : on n'édite pas un message envoyé. Un litige s'arbitre sur
-- ce qui a été dit, pas sur ce qui reste — même règle que `ride_events`, et même refus
-- bruyant plutôt qu'un silence.
CREATE OR REPLACE FUNCTION vora_ride_messages_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ride_messages est un journal : envoyez un autre message, ne modifiez pas celui-ci (id=%)', OLD.id;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "ride_messages_immutable" BEFORE UPDATE ON "ride_messages"
  FOR EACH ROW EXECUTE FUNCTION vora_ride_messages_immutable();
