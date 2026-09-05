// vora_theme.dart — Jetons de la charte graphique VORA v1.0
// Source de vérité : VORA_charte_graphique.html. Toute nouvelle couleur passe d'abord par la charte.

import 'package:flutter/material.dart';

class VoraColors {
  VoraColors._();

  // Marque
  static const Color blanc = Color(0xFFFFFFFF);
  static const Color bleu = Color(0xFF1F5EFF); // Bleu VORA
  static const Color bleuPresse = Color(0xFF174BD1);
  static const Color bleuNuit = Color(0xFF0B2A6F);
  static const Color bleuCiel = Color(0xFFE8F0FF);
  static const Color bleuPale = Color(0xFFF4F7FF);
  static const Color jauneTaxi = Color(0xFFFFC42E); // Le point. Jamais en fond, jamais en texte.

  // Neutres
  static const Color encre = Color(0xFF1E293B);
  static const Color gris = Color(0xFF5B6B84);
  static const Color grisClair = Color(0xFF94A3B8);
  static const Color bordure = Color(0xFFDDE3EE);
  static const Color surface = Color(0xFFF4F6FA);

  // Sémantiques (texte / fond)
  static const Color ok = Color(0xFF0F7A47);
  static const Color okFond = Color(0xFFDDF5E7);
  static const Color attention = Color(0xFFB25E00);
  static const Color attentionFond = Color(0xFFFFF1DD);
  static const Color sos = Color(0xFFD92D20);
  static const Color sosFond = Color(0xFFFDE3E1);

  // Mode nuit chauffeur
  static const Color nuit900 = Color(0xFF06153A);
  static const Color nuit800 = Color(0xFF0B2A6F);
  static const Color nuit700 = Color(0xFF12388F);
  static const Color bleuSurNuit = Color(0xFF6D9BFF);
  static const Color texteNuit = Color(0xFFF4F7FF);
  static const Color texteNuitSecondaire = Color(0xFFB7C4E2);
  static const Color okNuit = Color(0xFF7BE0A8);
}

class VoraSpacing {
  VoraSpacing._();
  static const double s1 = 4;
  static const double s2 = 8;
  static const double s3 = 12;
  static const double s4 = 16;
  static const double s5 = 24;
  static const double s6 = 32;
  static const double s7 = 48;
  static const double s8 = 64;
}

class VoraRadius {
  VoraRadius._();
  static const double sm = 8;
  static const double md = 12; // champs, boutons
  static const double lg = 16; // cartes
  static const double xl = 24; // feuilles, modales
  static const double pill = 999; // puces, badges
}

class VoraDurations {
  VoraDurations._();
  static const Duration rapide = Duration(milliseconds: 120);
  static const Duration standard = Duration(milliseconds: 200);
  static const Duration lente = Duration(milliseconds: 320);
  static const Curve courbe = Cubic(0.2, 0, 0, 1);
}

class VoraText {
  VoraText._();
  static const String display = 'Sora';
  static const String body = 'IBMPlexSans';

  static const TextStyle affiche = TextStyle(
      fontFamily: display, fontWeight: FontWeight.w800, fontSize: 40, height: 44 / 40, letterSpacing: -0.8);
  static const TextStyle prix = TextStyle(
      fontFamily: display,
      fontWeight: FontWeight.w800,
      fontSize: 34,
      height: 36 / 34,
      fontFeatures: [FontFeature.tabularFigures()]);
  static const TextStyle titre1 =
      TextStyle(fontFamily: display, fontWeight: FontWeight.w700, fontSize: 28, height: 34 / 28);
  static const TextStyle titre2 =
      TextStyle(fontFamily: display, fontWeight: FontWeight.w600, fontSize: 22, height: 28 / 22);
  static const TextStyle titre3 =
      TextStyle(fontFamily: body, fontWeight: FontWeight.w600, fontSize: 16, height: 24 / 16);
  static const TextStyle corps =
      TextStyle(fontFamily: body, fontWeight: FontWeight.w400, fontSize: 16, height: 24 / 16);
  static const TextStyle corpsFort = TextStyle(
      fontFamily: body,
      fontWeight: FontWeight.w600,
      fontSize: 16,
      height: 24 / 16,
      fontFeatures: [FontFeature.tabularFigures()]);
  static const TextStyle petit =
      TextStyle(fontFamily: body, fontWeight: FontWeight.w400, fontSize: 14, height: 20 / 14);
  static const TextStyle legende = TextStyle(
      fontFamily: body, fontWeight: FontWeight.w500, fontSize: 12, height: 16 / 12, letterSpacing: 0.96);
  static const TextStyle bouton =
      TextStyle(fontFamily: body, fontWeight: FontWeight.w600, fontSize: 16, height: 20 / 16);
}

TextTheme _textTheme(Color texte, Color secondaire, Color prix) => TextTheme(
      displayLarge: VoraText.affiche.copyWith(color: VoraColors.bleuNuit),
      displayMedium: VoraText.prix.copyWith(color: prix),
      headlineLarge: VoraText.titre1.copyWith(color: VoraColors.bleuNuit),
      headlineMedium: VoraText.titre2.copyWith(color: VoraColors.bleuNuit),
      titleMedium: VoraText.titre3.copyWith(color: texte),
      bodyLarge: VoraText.corps.copyWith(color: texte),
      bodyMedium: VoraText.petit.copyWith(color: texte),
      labelLarge: VoraText.bouton.copyWith(color: texte),
      labelSmall: VoraText.legende.copyWith(color: secondaire),
    );

/// Thème clair : appli passager et appli chauffeur de jour.
final ThemeData voraLightTheme = ThemeData(
  useMaterial3: true,
  fontFamily: VoraText.body,
  scaffoldBackgroundColor: VoraColors.blanc,
  colorScheme: const ColorScheme(
    brightness: Brightness.light,
    primary: VoraColors.bleu,
    onPrimary: VoraColors.blanc,
    secondary: VoraColors.jauneTaxi,
    onSecondary: VoraColors.bleuNuit,
    surface: VoraColors.blanc,
    onSurface: VoraColors.encre,
    error: VoraColors.sos,
    onError: VoraColors.blanc,
    outline: VoraColors.bordure,
    surfaceContainerHighest: VoraColors.surface,
  ),
  textTheme: _textTheme(VoraColors.encre, VoraColors.gris, VoraColors.bleu),
  elevatedButtonTheme: ElevatedButtonThemeData(
    style: ElevatedButton.styleFrom(
      backgroundColor: VoraColors.bleu,
      foregroundColor: VoraColors.blanc,
      disabledBackgroundColor: VoraColors.surface,
      disabledForegroundColor: VoraColors.grisClair,
      minimumSize: const Size.fromHeight(52),
      elevation: 0,
      textStyle: VoraText.bouton,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(VoraRadius.md)),
    ),
  ),
  outlinedButtonTheme: OutlinedButtonThemeData(
    style: OutlinedButton.styleFrom(
      foregroundColor: VoraColors.bleu,
      minimumSize: const Size.fromHeight(52),
      side: const BorderSide(color: VoraColors.bleu, width: 2),
      textStyle: VoraText.bouton,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(VoraRadius.md)),
    ),
  ),
  textButtonTheme: TextButtonThemeData(
    style: TextButton.styleFrom(
      foregroundColor: VoraColors.bleu,
      minimumSize: const Size(48, 48),
      textStyle: VoraText.bouton,
    ),
  ),
  inputDecorationTheme: InputDecorationTheme(
    filled: true,
    fillColor: VoraColors.blanc,
    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 16),
    hintStyle: VoraText.corps.copyWith(color: VoraColors.grisClair),
    labelStyle: VoraText.petit.copyWith(color: VoraColors.encre, fontWeight: FontWeight.w600),
    helperStyle: VoraText.petit.copyWith(color: VoraColors.gris, fontSize: 13),
    errorStyle: VoraText.petit.copyWith(color: VoraColors.sos, fontSize: 13),
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(VoraRadius.md),
      borderSide: const BorderSide(color: VoraColors.bordure, width: 1.5),
    ),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(VoraRadius.md),
      borderSide: const BorderSide(color: VoraColors.bordure, width: 1.5),
    ),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(VoraRadius.md),
      borderSide: const BorderSide(color: VoraColors.bleu, width: 1.5),
    ),
    errorBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(VoraRadius.md),
      borderSide: const BorderSide(color: VoraColors.sos, width: 1.5),
    ),
  ),
  cardTheme: CardTheme(
    color: VoraColors.blanc,
    elevation: 0,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(VoraRadius.lg),
      side: const BorderSide(color: VoraColors.bordure),
    ),
  ),
  chipTheme: ChipThemeData(
    backgroundColor: VoraColors.blanc,
    selectedColor: VoraColors.bleuCiel,
    side: const BorderSide(color: VoraColors.bordure, width: 1.5),
    labelStyle: VoraText.petit.copyWith(color: VoraColors.encre, fontWeight: FontWeight.w500),
    shape: const StadiumBorder(),
  ),
  dividerColor: VoraColors.bordure,
);

/// Thème nuit : appli chauffeur de 19 h à 6 h.
final ThemeData voraNightTheme = ThemeData(
  useMaterial3: true,
  fontFamily: VoraText.body,
  scaffoldBackgroundColor: VoraColors.nuit900,
  colorScheme: const ColorScheme(
    brightness: Brightness.dark,
    primary: VoraColors.bleu,
    onPrimary: VoraColors.blanc,
    secondary: VoraColors.jauneTaxi,
    onSecondary: VoraColors.bleuNuit,
    surface: VoraColors.nuit800,
    onSurface: VoraColors.texteNuit,
    error: VoraColors.sos,
    onError: VoraColors.blanc,
    outline: VoraColors.nuit700,
    surfaceContainerHighest: VoraColors.nuit800,
  ),
  textTheme: _textTheme(VoraColors.texteNuit, VoraColors.texteNuitSecondaire, VoraColors.bleuSurNuit)
      .apply(displayColor: VoraColors.texteNuit),
  elevatedButtonTheme: voraLightTheme.elevatedButtonTheme,
  cardTheme: CardTheme(
    color: VoraColors.nuit800,
    elevation: 0,
    shape: RoundedRectangleBorder(
      borderRadius: BorderRadius.circular(VoraRadius.lg),
      side: const BorderSide(color: VoraColors.nuit700),
    ),
  ),
  dividerColor: VoraColors.nuit700,
);
