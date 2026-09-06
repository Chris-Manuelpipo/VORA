// VORA — reconnaissance d'une image à partir de ses OCTETS, jamais de son en-tête.
//
// POURQUOI ON NE FAIT PAS CONFIANCE AU `Content-Type`. Il est envoyé par le client, donc
// par n'importe qui. Un fichier HTML annoncé `image/jpeg` serait stocké, puis resservi
// plus tard par `GET /v1/media/:id` — et un navigateur qui l'ouvre exécuterait son script,
// sur notre domaine, avec le jeton de la personne qui regarde. C'est une faille classique,
// et elle se referme en huit octets de vérification.
//
// On lit donc le nombre magique du fichier, et c'est LUI qui décide du type stocké et du
// type renvoyé. Trois formats, choisis pour ce que fait un téléphone Android :
// JPEG (photo), PNG (capture, image transparente), WebP (le plus léger, réseau faible).
//
// Fonctions pures : aucune base, aucun réseau, testées seules.

export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

/**
 * Taille maximale acceptée pour une photo de profil : 2 Mo.
 *
 * Ce n'est PAS la taille visée. Une photo d'avatar correcte fait 512 × 512 et pèse une
 * soixantaine de kilo-octets ; c'est au téléphone de redimensionner avant d'envoyer, et
 * c'est écrit dans le message d'erreur. La borne est là pour qu'un doigt qui glisse sur
 * la photo d'origine de 6 Mo reçoive un refus lisible, pas un timeout.
 */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Un fichier plus petit que ça n'est pas une image, c'est un accident. */
const MIN_IMAGE_BYTES = 64;

/** Extension de fichier correspondante — sert aux en-têtes de téléchargement et aux tests. */
export const IMAGE_EXTENSIONS: Record<ImageMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function startsWith(buffer: Buffer, bytes: number[]): boolean {
  if (buffer.length < bytes.length) return false;
  return bytes.every((byte, index) => buffer[index] === byte);
}

/**
 * Le type réel d'une image, d'après ses premiers octets. `null` si ce n'en est pas une.
 *
 *   JPEG  FF D8 FF
 *   PNG   89 50 4E 47 0D 0A 1A 0A
 *   WebP  « RIFF » …taille… « WEBP »
 */
export function sniffImageType(buffer: Buffer): ImageMimeType | null {
  if (buffer.length < MIN_IMAGE_BYTES) return null;

  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';

  // WebP : le conteneur RIFF porte sa taille entre les deux marqueurs, d'où le saut.
  if (
    startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    buffer.length >= 12 &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  return null;
}
